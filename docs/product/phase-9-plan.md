# Phase 9 — Library, history, and data rights: implementation plan

Status: **written, awaiting approval — no implementation has started**  
Date: 2026-08-07  
Decisions: [phase-9-scope.md](phase-9-scope.md) (all seven closed)  
Builds on: [phase-8-plan.md](phase-8-plan.md),
[data-flow.md](../architecture/data-flow.md),
[threat-model.md](../security/threat-model.md)

## What this phase delivers

A listener can find what they kept, retrace how they found it, and take it all
away. Favourites gain tags, notes and the explanation that made them worth
keeping; history starts recording and can be read and deleted; and the data a
listener owns becomes enumerable, which is what makes deletion checkable rather
than merely claimed.

## The decisions this plan implements

| # | Decision |
| --- | --- |
| 1 | Tags as `text[]` with a GIN index and a normalising trigger; AND filtering |
| 2 | Genuine delete, in-memory undo window; bulk delete states its count and offers no undo |
| 3 | History records discovery, mood and discography, forward only; nothing synthesised |
| 4 | Explanations stored twice: `discovery_results` for history, a versioned snapshot on the favourite |
| 5 | Conversations are history, one session row each, resolved by `(user_id, canonical_artist_id)` |
| 6 | Export documented only; the enumeration ships with no HTTP surface |
| 7 | Keyset cursor on `(sort_key, id)`, companion count, select-all scoped to loaded rows |

## The defect this phase exists to fix first

Nothing writes `discovery_sessions` or `discovery_results`. `app/history/page.tsx`
reads the first and renders whatever comes back, so **the history page has always
been empty and gives no sign of it**. Step 3 is where that changes, and it is
deliberately early: everything else in history is presentation over data that
does not yet exist.

## Work breakdown, in dependency order

### Step 1 — Boundary enforcement first

As in Phase 8, before any feature code, so the boundary is a property of the
module graph rather than a retrofit.

- `eslint.config.mjs`: `lib/library/**` and `features/library/**` join the rule
  forbidding `**/providers/spotify/**`, and gain a rule forbidding `lib/ai/**` —
  the library reads stored explanations and must never generate one.
- `tests/compliance/spotify-boundary.test.ts`: both directions asserted by
  repository scan, matching the two assertions Phase 8 added.

**Deliverable:** failing-then-passing boundary assertions, no feature code.

### Step 2 — One migration, and the types it changes

`supabase/migrations/20260807HHMMSS_phase_9_library_and_history.sql`:

1. **Widen** `discovery_sessions_input_kind_check` to
   `('artist', 'mood', 'discography')` (decision 3).
2. **`favorite_discoveries` gains** (decisions 1 and 4):
   - `tags text[] not null default '{}'`, with
     `check (array_length(tags, 1) is null or array_length(tags, 1) <= 20)`
   - `explanation jsonb` — `summary`, `sharedCharacteristics`, `contrast`,
     `startingPoint`
   - `explanation_version integer`
   - `explanation_source text check (... in ('ai', 'template'))`
   - `explanation_provider text` and `explanation_model text`, matching the
     widened provider vocabulary
   - `check ((explanation is null) = (explanation_version is null))`, so a
     snapshot cannot exist without the version needed to render it
3. **Normalising trigger** `normalize_favorite_tags()`, `before insert or
   update`: trim, lowercase, drop empties, deduplicate, reject any element
   outside 1–40 characters. This exists because CHECK constraints cannot contain
   subqueries, so per-element rules are not expressible as constraints.
4. **GIN index** on `tags` for `&&` filtering.
5. **Keyset indexes**: `(user_id, created_at desc, id)` on
   `favorite_discoveries` and `discovery_sessions`, and
   `(user_id, artist_name, id)` on `favorite_discoveries` for the alphabetical
   sort.
6. **`export_user_data(p_user_id uuid) returns jsonb`** (decision 6):
   `security definer`, `set search_path = ''`, `stable`, revoked from
   `PUBLIC`/`anon`/`authenticated`, granted to `service_role` only — the same
   pattern as `claim_ai_usage` and `read_ai_usage_remaining`.

Then `npm run db:types`, reformat, and confirm nothing else in the generated
file moved.

**No table grants to `service_role` and no `private` schema usage are added.**

### Step 3 — Record sessions, forward only

The defect fix, and the most invasive step because it touches three shipped
phases. `lib/library/sessions.ts` plus small call-site changes:

- **Discovery** (`features/discovery/service.ts`): a session per search, its
  results written to `discovery_results` with the rationale and provider that
  produced them.
- **Mood** (`features/mood/service.ts`): a session per interpretation, linked to
  a generated playlist through the `discovery_session_id` column that already
  exists on `generated_playlists`.
- **Discography** (`features/discography/actions.ts`): one session per
  *conversation*, not per question (decision 5). `completed_at` is set on the
  first successful answer; later questions move `updated_at`. Resolved by
  `(user_id, canonical_artist_id)`, so no Phase 8 table is migrated.

A session write must never fail a listener's request. Every call is
best-effort and logged on failure: history is a record of work, not a
precondition for it.

**Nothing is backfilled.** Existing accounts start with an empty history and the
empty state says history began when the feature did.

### Step 4 — Snapshot the explanation at save time

`features/discovery/repository.ts` gains the snapshot on save (decision 4).
`lib/library/explanation-snapshot.ts`, pure: maps a `DiscoveryExplanation` to the
stored shape, drops `groundedIn`, and stamps the version. A reader for the
inverse, tolerant of an unknown version — an old row renders what it can and says
it is a snapshot rather than failing.

### Step 5 — Library reads: cursor, filters, tags

`lib/library/cursor.ts`, pure and unit-tested: encode and decode a
`(sort_key, id)` cursor for each of newest, oldest and alphabetical, with the
`id` tiebreaker. Invalid cursors resolve to the first page rather than an error.

`features/library/repository.ts`: one parameterised keyset query, filters for
entity type, source and tags (AND across tags), free-text search over artist,
recording and note, plus the companion count query decision 7 requires.

### Step 6 — Delete, undo, and bulk

`features/library/actions.ts`:

- Single delete removes the row. The client holds it for roughly ten seconds or
  until navigation, and undo re-inserts it — with a new `id` and `created_at`,
  which the interface states rather than conceals.
- Bulk delete states the exact count, is scoped to loaded rows, and offers no
  undo.
- POST-only mutations under the CSRF protections T17 already requires.

### Step 7 — History reads and deletion

`features/history/repository.ts`: the same cursor implementation over
`discovery_sessions`, joined to results, playlists and conversations for
display. Per-entry delete, and a delete-all with a stated count.

Deleting a history entry must not delete a Spotify playlist that exists in
someone's account, and [data-flow.md:150](../architecture/data-flow.md:150)
already commits to the interface explaining that distinction.

### Step 8 — Enumeration and documentation

- `lib/privacy/user-data.ts`: a thin server-side caller of `export_user_data`.
  No route, no HTTP surface.
- `docs/security/data-handling.md`: what is stored, in which class, for how
  long, and the honest export procedure — operator-run, on request, JSON out.
  **No "export from settings" language**, because no such control exists.

### Step 9 — Interface

`features/library/components/` and `features/history/components/`, replacing the
Phase 1/2 stubs at `app/library/page.tsx` and `app/history/page.tsx`.

Library: search, entity and source filters, tag filter with autocomplete from
`distinct unnest(tags)`, sort control, note editing, tag editing, per-item
remove with undo, bulk selection with a stated count, load-more stating what
remains, and **two distinct empty states** — "no favourites yet" and "no
favourites match these tags" — because they call for different actions.

History: what was asked, what was selected, which provider answered, the result
status, any playlist created, the question count for a conversation, and when.
Per-entry delete. An empty state that says history began with the feature.

## Verification plan

| Gate | What Phase 9 adds |
| --- | --- |
| Unit | Cursor encode/decode across all three sorts, including the `id` tiebreaker and an invalid cursor; explanation snapshot mapping and tolerant reading of an unknown version; tag filter composition |
| Integration | Library repository against a stubbed client: filter composition, AND-tag semantics, count agreeing with the page query |
| Compliance | The two new boundary assertions from step 1 |
| pgTAP | Tag trigger normalisation and the 20-count cap; **residual-data after delete — the row is absent from the table, not filtered from a view** (decision 2); `export_user_data` covers **every** `public` table carrying a `user_id` column, compared against `information_schema`, so a table added later fails until registered; `export_user_data` returns empty after account deletion (T23); RLS on the new columns |
| Live database | Cursor pagination walked across pages with two signed-in users, asserting no row is skipped or repeated and that neither user sees the other's rows; tag filtering; session writes from all three flows |
| E2E | Search, filter, sort, tag, bulk selection with count, delete and undo, both empty states, history entries with question counts, per-entry deletion |
| Accessibility | axe over library and history **including hover states** on the bulk-selection and delete controls |

Full gate before commit: format, lint, typecheck, vitest, build, Playwright
(both projects, `@a11y` separately), `db:reset` / `db:test` / `db:lint`,
`LIVE_DATABASE=1`, `LIVE_PROVIDERS=1`. Exit codes checked directly, never
through a pipe.

## Risks

- **Step 3 touches three shipped phases.** It is the only step that modifies
  Phase 6, 7 and 8 code, and a mistake there is a regression in working
  features rather than a defect in a new one. Session writes are best-effort and
  wrapped so they cannot fail a listener's request.
- **Bulk delete is irreversible by design.** The count in the confirmation is
  the only control, so it must be the real count and not a page size.
- **The enumeration drift test is only as good as its comparison.** It asserts
  against `information_schema`, so a user-owned table that does not use the
  column name `user_id` would slip past it. Naming stays conventional, and the
  test's assumption is written down where the next person will see it.
- **Stored explanations go stale.** A snapshot may cite a release that has since
  been merged or retitled in MusicBrainz. The interface dates it rather than
  presenting it as current.
- **History starts empty for every existing account.** Correct, decided, and
  the empty state has to carry it without implying loss.

## Explicitly out of scope

Sharing or public library pages; cross-device sync beyond Postgres; editing a
generated playlist after creation; re-running a past discovery from history
(retrieval and ranking have changed between phases, so a replay would not
reproduce the result and presenting it as one would be a claim the product
cannot honour); and the export download, route and interface, which defer to
Phase 12 with the privacy-policy draft.

## Exit

A Phase 9 report in the standard format, then approve Phase 10 separately.
