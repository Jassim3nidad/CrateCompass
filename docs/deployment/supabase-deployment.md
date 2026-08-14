# Supabase deployment

Managing the production database. Written from the Phase 12 deployment, which
brought a project five migrations behind up to date.

---

## Project

| | |
| --- | --- |
| Project ref | `tkmajksgyyuvuckongxr` |
| Region | `ap-northeast-1` |
| Postgres | 17 |
| Migration state | All 11 applied |

The repository is linked via `supabase/.temp/project-ref` (gitignored).

```bash
npx supabase link --project-ref tkmajksgyyuvuckongxr
```

Authenticate with `npx supabase login`, which stores a session locally. A
personal access token (`sbp_…`) is account-wide — it can create, read and delete
**every** project in the organisation. Do not paste one into a chat or a script;
if you have, revoke it at
https://supabase.com/dashboard/account/tokens.

---

## Applying migrations

**Always inspect before pushing.** `db push` applies everything pending, to a
live database, with no dry run of the data impact.

```bash
npx supabase migration list --linked
```

Rows where `remote` is empty are pending. Then read them — specifically for
anything destructive:

```bash
grep -niE '^\s*(drop|truncate|delete from|alter table .* drop)' supabase/migrations/<pending>.sql
```

Phase 12 found three categories of match, all benign, and it is worth knowing
why so the same check does not raise a false alarm next time:

| Match | Verdict |
| --- | --- |
| `drop constraint …_check` followed by a re-add | Widening a check constraint. Safe. |
| `drop index if exists` followed by a create | Index replaced to add a keyset tiebreaker. Safe. |
| `delete from private.idempotency_records` | Inside `security definer` **function bodies** (expiry purge, idempotency release), not migration-time statements. Safe. |

The distinction that matters: a `delete` at the top level of a migration removes
data now; the same line inside `as $$ … $$` is code that runs later under the
application's control.

Then push and verify:

```bash
npx supabase db push --linked
npx supabase migration list --linked      # every row must have a remote value
```

> A `failed to cache migrations catalog … ECONNREFUSED` warning after a
> successful push is the CLI's local catalog cache failing over IPv6. The
> migrations applied; confirm with `migration list`.

> The Supabase management API returns Cloudflare 502s intermittently, marked
> `retryable: true, retry_after: 60`. Back off for a minute and retry rather
> than assuming a real failure.

---

## Keys

```bash
npx supabase projects api-keys --project-ref <ref> --reveal
```

**`--reveal` is mandatory for secret keys.** Without it the CLI returns the
value masked with `·` characters, at the correct length, which configures
cleanly and fails at runtime. Validate before use:

```bash
[[ "$KEY" =~ ^sb_secret_[A-Za-z0-9_-]+$ ]] || echo "masked or malformed"
```

Four keys exist per project: legacy `anon` and `service_role` JWTs, and the
current `sb_publishable_…` / `sb_secret_…` pair. This application uses the
current pair.

---

## Security model

Do not change these without reading `docs/architecture/database-plan.md`.

- **RLS is enabled on all 15 tables** across `public` and `private`.
- **`service_role` has no table grants and no `private` schema usage.**
  Privileged work goes through `security definer` functions granted to
  `service_role` alone: `claim_ai_usage`, `read_ai_usage_remaining`,
  `purge_ai_usage_events`, `export_user_data`.
- A permission error is usually the design working. Add a `security definer`
  function, not a table grant.
- Owner-immutability triggers prevent a row's `user_id` being reassigned.

Verify against the local stack, which is schema-identical:

```bash
npm run db:reset && npm run db:test && npm run db:lint
```

140 pgTAP assertions across six files cover owner, cross-user, anonymous,
ownership-mutation and child-parent access, plus the residual-data check that
account deletion leaves nothing behind.

---

## Backup and recovery

**Not configured beyond the plan defaults, and never rehearsed.**

Free-tier projects get daily backups with limited retention and no
point-in-time recovery. Before a pilot with real users:

1. Confirm the retention window on the current plan.
2. Enable PITR if the plan allows.
3. **Rehearse a restore.** An unrehearsed backup is a hypothesis.

Manual snapshot before a risky change:

```bash
npx supabase db dump --linked -f backup-$(date +%Y%m%d).sql
```

---

## Rollback

Migrations are forward-only by design. There are no down migrations, because a
reversible-by-construction schema tends to be a schema nobody has thought hard
enough about.

To undo a schema change, write a new migration that undoes it, test it against a
`db reset` locally, and push that. Do not edit an applied migration file: the
CLI tracks them by version, and editing one desynchronises local and remote
without telling you.

For an application rollback, see
[`vercel-deployment.md`](vercel-deployment.md). Because the applied migrations
are additive, an older build runs against the newer schema without harm.
