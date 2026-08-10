# CrateCompass — session handoff

Written: 2026-08-10 · Branch: `master`, clean, synced with `origin/master`

Feed this to a new session together with the master system prompt. It covers
state, hard constraints, environment quirks, and the decisions currently
blocking progress. Everything here is verified unless marked otherwise.

---

## 1. Where the project is

Phases 0–10 are complete, verified, and pushed. Phase 11 (production hardening
and private-pilot release) has not started and needs separate approval.

| Phase | State |
| --- | --- |
| 0 Discovery and planning | Complete |
| 1 Foundation (Next.js, tokens, route shells) | Complete |
| 2 Supabase auth + schema + RLS | Complete |
| 3 Spotify connected account (PKCE) | Complete |
| 4 MusicBrainz + ListenBrainz providers | Complete |
| 5 AI abstraction + safety boundary | Complete |
| 6 Similar-artist discovery | Complete |
| 7 Natural-language mood playlists | Complete |
| 8 Discography explorer + Q&A | Complete |
| 9 Library, history, data rights | Complete |
| 10 UI/UX polish and motion | Complete |
| 11 Production hardening + private pilot | **Not started — needs approval** |

Note the renumbering. The roadmap listed hardening as Phase 10; the master
prompt's Phase 10 is UI/UX polish and motion. Polish was implemented as Phase 10
and hardening became Phase 11, which also resolves the roadmap ending at 10
while this document already referred to "Phases 9–12".

**The working process is a hard rule.** Each phase is inspected, planned,
approved, implemented, verified, and reported before the next begins. Do not
start Phase 11 implementation without explicit approval — the owner ended the
last session with "wait for my explicit go-ahead before doing anything else".

---

## 2. The constraint everything else serves

**No Spotify content may reach an AI provider. Ever.** This is the product's
defining compliance boundary, not a style preference. It is enforced in four
independent ways, and all four must keep passing:

1. **Type level.** Spotify values are branded (`SpotifyResourceId`,
   `SpotifyUri`); AI input types are built from plain strings and cannot accept
   them.
2. **Runtime gateway.** Every AI call goes through `buildAiInput` in
   `lib/ai/gateway.ts`: strict Zod schema (unknown key = rejection), provenance
   allowlist, recursive scan for Spotify hosts/URIs/credentials, size caps.
3. **Module graph.** ESLint `no-restricted-imports` rules keep the trees
   disjoint:
   - `lib/ai/**` cannot import `providers/spotify/**`
   - `lib/discovery/**`, `features/discovery/**`, `lib/mood/**`,
     `features/mood/**` cannot import `providers/spotify/**`
   - `lib/providers/spotify/**` and `features/playlists/**` cannot import AI
     modules
4. **Repository scan.** `tests/compliance/spotify-boundary.test.ts` asserts all
   of the above by reading the source tree, plus log redaction and the fixture
   gate.

Spotify's only permitted roles: OAuth connection, `GET /me`, `GET /search` for
resolving already-chosen candidates, `POST /me/playlists`,
`POST /playlists/{id}/items`, and deep links. It must never influence *which*
music is recommended — including which track represents an artist (settled in
`docs/product/phase-7-scope.md`).

---

## 3. Provider facts learned the hard way

These were measured against live services. Re-probing costs time; trust them
unless behaviour changes.

- **MusicBrainz caps `inc=release-groups` at 25, silently.** Portishead has
  exactly 25, which is why this hid for two phases. Nirvana has 573. Fixed in
  `330faea`: a result of exactly 25 escalates to paginated
  `browseReleaseGroups`. Safety bound of 10 pages exists because the "Various
  Artists" entity holds **288,991** release groups (~45 min at 1 req/sec).
- **MusicBrainz is paced at one request per second**, globally, via
  `lib/providers/musicbrainz/pacer.ts`. Building a 12-artist playlist is 24–36
  requests. Tests that exercise paging should mock the pacer.
- **MusicBrainz tag search ranks by Lucene relevance, not quality.**
  `tag:"trip hop"` returns Madonna in the top three; `tag:"ambient"` returns
  `[unknown]` first. Hence placeholder filtering, vote-count re-ranking, and a
  required human seed-confirmation step.
- **ListenBrainz similar-artists** comes from `labs.api.listenbrainz.org` — a
  research surface with no stability guarantee. Errors return HTML, not JSON.
  Unknown MBID returns `200 []`.
- **The ListenBrainz popularity API is server-side disabled**
  (`500 — "Popularity API currently disabled due to high load"`, confirmed
  twice). This is why playlist tracks are studio-album openers rather than
  ranked. Tracked follow-up in the roadmap; the port is ready for an adapter.
- **Spotify search caps at 10 results**; playlist items batch at 100.

---

## 4. Environment — the part that will waste your time

Docker Desktop needs admin and in-WSL Docker needs `sudo`; neither was
available. The stack runs on **rootless Podman**. Full detail in
`docs/setup/local-database.md`. The essentials:

```bash
# Every session, after a reboot:
podman machine start
podman machine ssh "systemd-run --user --unit=podman-tcp --collect podman system service --time=0 tcp://127.0.0.1:2375"
```

Then `DOCKER_HOST=tcp://127.0.0.1:2375` must be set (already in the user PATH
env), and Podman's bin must be on `PATH`:
`%LOCALAPPDATA%\Programs\podman\podman-6.0.2\usr\bin`.

Start Supabase with services excluded — two of them get a Windows path as a
container workdir and fail:

```bash
npx supabase start -x edge-runtime,studio,imgproxy,logflare,vector,mailpit,realtime,storage-api,supavisor
```

Known quirks:

- `win-sshproxy.exe` fails to start, so there is no `docker_engine` named pipe.
  The loopback TCP socket above is the substitute.
- The WSL2 kernel has no nftables, so netavark's firewall driver is set to
  `none` in the machine's `containers.conf`. Without it, containers fail to
  start.
- `supabase gen types --local` **omits** the `__InternalSupabase` block. It is
  preserved by hand in `types/database.ts` — re-add it after every
  `npm run db:types`.
- The Podman machine stops between sessions and the TCP unit is transient, so
  both commands above are needed again after any reboot.

**The e2e suite requires a running local Supabase** and points both the app and
the spec process at it (`playwright.config.ts`). Accounts are created and
deleted per test.

---

## 5. Verification — the standard every phase has met

```bash
npm run format:check
npm run lint            # eslint --max-warnings=0
npm run typecheck       # tsc --noEmit, strict + exactOptionalPropertyTypes
npm test                # vitest run
npm run build
npx playwright test --grep-invert @a11y
npx playwright test --grep @a11y
npm run db:reset && npm run db:test && npm run db:lint
LIVE_DATABASE=1 npx vitest run tests/live
LIVE_PROVIDERS=1 npx vitest run tests/live/providers-live.test.ts
```

Last full run (all green at `330faea`):

| Gate | Result |
| --- | --- |
| Unit + integration + contract + compliance | 419 passed, 21 skipped |
| End-to-end | 91 passed, 3 skipped |
| Accessibility (axe) | 18 passed |
| pgTAP | 101 assertions across 4 files |
| Live database | 15 passed |
| Live providers | 6 passed |
| Production build | Pass |

Two suites are opt-in and skip by default so `npm test` stays offline:
`LIVE_PROVIDERS=1` (real MusicBrainz/ListenBrainz/Gemini) and `LIVE_DATABASE=1`
(real Postgres with two signed-in users). They exist because mocks cannot prove
the provider factories or RLS actually work.

---

## 6. Test fixtures and the seam that makes them safe

Provider calls happen server-side, so Playwright cannot intercept them. Fixture
implementations exist for MusicBrainz, ListenBrainz, AI, and Spotify, selected
by four factories:

- `lib/providers/musicbrainz/index.ts`
- `lib/providers/discovery/index.ts`
- `lib/providers/spotify/index.ts`
- `lib/ai/index.ts`

All four consult `areProviderFixturesEnabled()`, which requires
**`APP_ENV=test` AND `PROVIDER_FIXTURES=1`**. The environment schema *refuses to
validate* that flag outside a test environment, so a deployment carrying it
fails to boot rather than serving invented artists. The compliance suite asserts
that only those four modules import fixtures.

The fixture AI provider still calls `buildAiInput`, so the boundary gateway runs
exactly as in production.

---

## 7. Things that will bite you

- **AI usage limits are 20/user/day and 4/user/minute**, enforced in Postgres
  and failing closed. One pass through the mood flow spends three. Tests must
  use a fresh account per test or they trip a limit that is working correctly.
- **`service_role` has no table grants and no `private` schema usage.** This is
  deliberate least privilege, confirmed against `database-plan.md` and the
  Phase 3/5 migrations. Privileged work goes through `security definer` RPCs
  granted to `service_role` only. Do not "fix" this by adding table grants.
- **The logger redacts any key matching `/token/i`.** A numeric-only allowlist
  exempts `inputTokens`/`outputTokens` so cost stays visible. Do not loosen the
  pattern.
- **Spotify scopes now include `playlist-modify-public`.** Every connection made
  before `e5cf4bb` is missing it and will surface as `insufficient-scope`. The
  reconnect copy explains this is a product change, not a fault.
- **Accessibility scans miss hover states.** A 3.88:1 contrast defect survived
  two phases because no button was hovered during a scan.
- **`npm run format:check | tail` masks the exit code.** Check `$?` directly.

---

## 8. Open items — blocking

### Awaiting the owner's review

**The re-authorization copy** in `docs/product/phase-7-reauthorization-copy.md`
is marked "draft, not signed off" but is **already wired** into
`features/spotify/connection-presentation.ts` and the creation error path
(commit `e5cf4bb`). Nothing is deployed, so no user has seen it. The owner asked
to hold off wiring it publicly; this was flagged and left in place because the
previous wording ("the private-playlist permission") is now factually wrong.
The owner may ask for it to be reverted to neutral wording.

### Blocking Phase 11

Nothing yet. Phase 11 is production hardening and the private-pilot release:
observability, runbooks, backups, CSP and security headers, dependency and
secret scanning, deployment and rollback, and the compliance re-review. Its
preconditions are operational rather than product decisions, and the roadmap
lists them.

Two things Phase 11 will have to decide rather than inherit:

- **Whether the private pilot goes ahead under Development Mode.** The five-user
  allowlist is an assumption from Phase 0 that has never been tested against a
  real user list.
- **Lighthouse in CI.** Phase 10 ran it manually (see §5); it is not a
  dependency and nothing enforces a score. Making it a gate is a Phase 11
  choice, and requires deciding which numbers are allowed to regress.

---

## 9. Map of the codebase

```
app/                     routes: /, /discover, /mood, /artists/[artistId], /library,
                         /history, /settings, /auth/*
features/
  discovery/             Phase 6: seed selection, evidence, explanations, save/dismiss
  mood/                  Phase 7: mood parse, seed confirm, draft building
  playlists/             Phase 7: idempotent Spotify creation (no AI imports)
  spotify/               connection lifecycle, link resolution, reauth copy
  auth/
lib/
  ai/                    port, 4 adapters + fixture, gateway, schemas, limits,
                         fallbacks, disclosure, prompts, diagnostics
  discovery/             evidence + explanation verification (pure)
  mood/                  controls, seed-ranking, track-selection (pure)
  matching/              deterministic artist + track resolution
  providers/             musicbrainz, discovery (listenbrainz), spotify, fixtures
  supabase/              server/client/admin/proxy
supabase/
  migrations/            9 migrations, all applied and reset-tested
  tests/                 4 pgTAP files, 101 assertions
tests/
  unit/ integration/ contract/ compliance/ e2e/ live/
docs/                    architecture (+5 ADRs), compliance, product, project,
                         security, setup
```

Key documents: `docs/architecture/provider-boundaries.md` (the boundary rules),
`docs/compliance/spotify-compliance.md`, `docs/project/implementation-roadmap.md`
(phase plan + tracked follow-ups), `docs/product/phase-10-design-system.md`
(tokens, motion, focus, and the accessibility gate).

Note: the root `README.md` is from Phase 1 and is stale. Phase 11 owns the
documentation pass — it was previously attributed to a "Phase 12" that the
roadmap never defined.

---

## 10. How the owner works

- Wants autonomous execution: fix problems found along the way, make judgment
  calls, do not ask permission to keep working.
- Wants to be interrupted only for decisions with real trade-offs — schema or
  API contract changes, security trade-offs, scope changes.
- Expects a status report per phase: what passed, what was fixed along the way,
  what is still open. Report failures with the actual output; never claim
  something is verified when it is not.
- Values honesty about gaps over tidy summaries. Several times the right answer
  has been "this is a real defect I introduced" or "the limiter was right and my
  test was wrong".
