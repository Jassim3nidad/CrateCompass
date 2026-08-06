# Phase 8 — Discography explorer and Q&A: implementation plan

Status: **written, awaiting approval — no implementation has started**  
Date: 2026-08-06  
Decisions: [phase-8-scope.md](phase-8-scope.md) (all four closed)  
Builds on: [phase-6-discovery.md](phase-6-discovery.md),
[phase-7-scope.md](phase-7-scope.md),
[provider-boundaries.md](../architecture/provider-boundaries.md)

## What this phase delivers

A listener browses an artist's complete release history and asks factual
questions about it. Every answer is grounded in retrieved MusicBrainz records
with sources they can check, and a question the data cannot answer gets
"the records do not say" rather than a plausible sentence.

## What already exists

Phase 8 is unusually well supplied, and the plan below is sized on the
assumption that none of this is rebuilt.

| Piece | Where | State |
| --- | --- | --- |
| Complete paged retrieval with a true total | `lib/providers/musicbrainz/client.ts` | Built in `330faea` |
| `releaseGroupTotal` / `releasesComplete` | same | Built, consumed by Phases 6 and 7 |
| Browse contract fixtures (two real pages) | `tests/fixtures/provider-evidence.json` | Built in `330faea` |
| `answerDiscographyQuestion` on the AI port | `lib/ai/provider.ts`, 4 adapters + fixture | Built, contract-tested |
| `discographyAnswerSchema` with `sufficientContext`, `citedReleaseIds` | `lib/ai/schemas.ts` | Built; ≤20 citations |
| `answerDiscographyQuestionInputSchema` | `lib/ai/schemas.ts` | Built; strict, ≤200 releases |
| `discography_conversations` / `discography_messages` + RLS | Phase 2 migration | Created, unused |
| Wider Q&A burst limit | `lib/ai/limits.ts` | Built in `5a0536d` |
| Grounding-verification pattern to copy | `lib/discovery/explanation.ts` | Built in Phase 6 |
| Release-type and partial-date normalisation | `lib/providers/musicbrainz/` | Built |

The genuinely new work is context selection, input neutralisation, the
conversation surface, citation verification, and the quota read.

## Work breakdown, in dependency order

### Step 1 — Boundary enforcement first

Done before any feature code, so the boundary is a property of the module graph
from the first commit rather than something retrofitted.

- `eslint.config.mjs`: add `lib/discography/**/*.ts` and
  `features/discography/**/*.ts` to the existing rule forbidding
  `**/providers/spotify/**`.
- `tests/compliance/spotify-boundary.test.ts`: extend the mood-module assertion
  to cover the discography paths, so the rule is checked by repository scan and
  not only by lint configuration.

**Deliverable:** two failing-then-passing boundary assertions, no feature code.

### Step 2 — Retrieval and caching (decision 1)

`lib/discography/retrieval.ts`

- Complete retrieval built on the existing paged `browseReleaseGroups`.
- Completeness accounting from `releaseGroupTotal` / `releasesComplete`.
- A dedicated six-hour TTL cache keyed by MBID, using `lib/providers/cache.ts`
  — which already guarantees failures are never cached, a cache fault degrades
  to a live call, and concurrent callers share one in-flight request.
- Chronological ordering with partial-date precision preserved.
- A `partial` result shape when the 10-page bound engages, carrying the true
  total so the interface can say "showing N of M" truthfully.

Staged progress reuses the Phase 7 pattern from `4edd671`. Six paced seconds on
a cold cache must read as work, not as a hang.

### Step 3 — Input neutralisation (decision 4)

`lib/discography/sanitize.ts`, pure.

- **Delimiting, blocking.** Wrap each retrieved record in an explicit escaped
  data envelope, escaping the delimiter itself so a title cannot break out.
- **Detection, logged only.** Flag instruction-shaped strings, emit a counter
  and a log line, and pass the value through unchanged.
- Return both the model-facing envelope and the untouched original, so the
  interface renders exactly what MusicBrainz holds.

The gateway is unchanged. `buildAiInput` enforces provenance, forbidden keys,
Spotify host/URI patterns and size caps; it has no notion of instruction-shaped
text and is not the right place to acquire one.

### Step 4 — Context selection

`lib/discography/selection.ts`, pure and deterministic.

- Question plus complete discography to a bounded context of at most 200
  releases, the bound `answerDiscographyQuestionInputSchema` already enforces.
- Selection criteria surfaced to the interface, so a listener can see what the
  answer was drawn from.
- Explicit "the retrieval was partial" signal, which makes counting questions
  refusable rather than answerable from a slice.

**This is where correctness is won or lost.** Filtering too aggressively drops
the release holding the answer; filtering too little overruns 200 on a prolific
artist. It gets the densest unit coverage in the phase.

### Step 5 — Citation verification

`lib/discography/verification.ts`, mirroring `lib/discovery/explanation.ts`.

- Every `citedReleaseIds` entry must be a release actually supplied.
- Any failure discards the whole answer and substitutes the deterministic
  insufficient-context response. Not partially trusted, and not repaired.

### Step 6 — Persistence and the quota read

`features/discography/repository.ts` — conversations and messages, request-scoped
client, RLS as the authority. No purge or TTL (decision 3).

**One migration**, `supabase/migrations/20260806HHMMSS_phase_8_discography.sql`:

- `read_ai_usage_remaining(p_user_id uuid, p_daily_limit integer)` returning the
  remaining daily count. `security definer`, `set search_path = ''`, `REVOKE ...
  FROM PUBLIC`, granted to `service_role` only — the same pattern as
  `claim_ai_usage`, for the same reason.
- No table grants to `service_role`, and no `private` schema usage. That
  least-privilege position is deliberate and stays.

This is the only schema change in the phase. It exists because
`private.ai_usage_events` is otherwise unreadable and neither existing function
reports a count without consuming a slot.

### Step 7 — Service and actions

- `features/discography/service.ts`: retrieve → sanitize → select → answer →
  verify, returning a closed union.
- `features/discography/actions.ts`: `askQuestion`, `loadTimeline`. Inputs
  parsed rather than trusted, because a server action is a public endpoint.

### Step 8 — Interface

`features/discography/components/` and
`app/artists/[artistId]/page.tsx`, replacing the placeholder card while keeping
`ArtistHeader` and the separately-resolved `SpotifyLink`.

- Release timeline, chronological, partial-date precision preserved.
- Filters: album, EP, single, live, compilation, soundtrack, other.
- Release detail with MusicBrainz source links.
- Q&A panel with conversation history.
- Suggested factual questions.
- Missing-data notice, and the "showing N of M" partial-retrieval notice.
- Remaining daily quota (decision 2), so a limit that fails closed is never a
  surprise.
- Open-in-Spotify resolved separately and on demand, exactly as Phase 6 does.

All eleven required interface states, including partial-result and
provider-unavailable.

## Verification plan

| Gate | What Phase 8 adds |
| --- | --- |
| Unit | Retrieval paging and completeness; sanitisation (delimiter escape, envelope integrity, detection logs but never blocks); selection bounds and criteria; citation verification including the discard path |
| Integration | Full service path against a stubbed provider, including partial retrieval and a manipulated-citation answer |
| Contract | Existing `answerDiscographyQuestion` coverage across all four adapters plus the fixture |
| Compliance | The two new boundary assertions from step 1 |
| pgTAP | New `supabase/tests/phase_8_discography.test.sql`: cross-user isolation for conversations and messages, owner-immutable triggers, cascade on account deletion. The Phase 2 file touches these tables four times, which asserts RLS is enabled, not that it isolates |
| E2E | Timeline and filters; a grounded answer with citations; an unanswerable question answered honestly; conversation persistence across reload; the partial-retrieval notice |
| Accessibility | axe on the explorer and the Q&A panel, **including hover states** — a 3.88:1 contrast defect survived two phases because no button was hovered during a scan |
| Live | One real prolific artist retrieved completely, asserted against the true total |

Full gate before commit: format, lint, typecheck, vitest, build, Playwright
(both projects, `@a11y` separately), `db:reset` / `db:test` / `db:lint`,
`LIVE_DATABASE=1`, `LIVE_PROVIDERS=1`. Exit codes checked directly, never
through a pipe.

## Risks

- **Selection correctness**, as above. Mitigated by test density, not by care.
- **Cold-cache latency** on a prolific artist. Mitigated by the progress state
  and the six-hour cache; not eliminated.
- **Detection heuristics tempting to over-build.** The decision is logged-only
  and should stay logged-only without new evidence.
- **The shared burst window** means heavy Q&A use blocks a mood parse. Known,
  accepted, and covered by a test.
- **Unbounded conversation growth**, with the roadmap tripwire as the control.

## Explicitly out of scope

Track-level questions (one paced request per release group is unaffordable),
cross-artist relationship questions, editorial questions (refused by design),
and conversation export or deletion controls (Phase 9 owns retention).

## Exit

A Phase 8 report in the standard format, then approve Phase 9 separately.
