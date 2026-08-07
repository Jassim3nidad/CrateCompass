# CrateCompass Implementation Roadmap

Status: Phase 0 baseline  
Last reviewed: 2026-08-02

## Delivery rules

- Each phase is independently approvable and ends before the next begins.
- Before modifying a phase, inspect repository state, dependencies, and uncommitted work; pull only when collaboration/remotes exist and it is safe.
- Every schema change is a migration.
- External providers are mocked in automated tests.
- A phase report separates verified, partially verified, blocked, and unverified work.
- Security/compliance gates may narrow or stop a feature; unavailable provider data is never fabricated.

## Phase 0 — Product discovery and technical plan

### Scope

- Product requirements, scope, journeys, acceptance criteria, and measurable success indicators.
- System architecture, provider boundaries, data flows, and database design.
- Threat model and current Spotify compliance review.
- Environment contract and phased roadmap.
- Last.fm versus ListenBrainz recommendation.

### Exit criteria

- All nine requested artifacts exist and agree on provider responsibilities.
- No application implementation is introduced.
- Spotify public-launch constraints and private-pilot assumption are explicit.
- Phase 1 requires separate approval.

## Phase 1 — Project foundation

### Scope

- Create a Next.js App Router application with strict TypeScript.
- Select and lock the Node.js/package-manager versions.
- Configure Tailwind CSS, shadcn/ui, React Hook Form, Zod, ESLint, and Prettier.
- Add Vitest, Testing Library, Playwright, and automated accessibility tooling.
- Add server/client environment validation and explicit `server-only` modules.
- Add structured logging with secret redaction.
- Build responsive, keyboard-accessible route shells for `/`, `/discover`, `/mood`, `/artists/[artistId]`, `/library`, `/history`, `/settings`, `/auth/sign-in`, `/auth/sign-up`, and `/auth/callback`.
- Add loading/error/not-found boundaries and reusable empty, error, skeleton, notification, and provider-status components.
- Establish original dark-neutral visual tokens without Spotify green as the brand color.

### Verification

- Format check, lint, strict type-check, unit tests, accessibility smoke test, Playwright route smoke test, secret/client-bundle scan, and production build.
- Keyboard and 320 CSS-pixel overflow checks.

### Exit gate

No provider functionality, authentication, database behavior, or decorative animation. Approve Phase 2 separately.

## Phase 2 — Supabase authentication and database

### Scope

- Cookie-based Supabase Auth for App Router: sign-up, confirmation, sign-in, sign-out, reset, refresh, and protected routes.
- Auth-aware navigation and safe return paths.
- Create public/private schemas, initial tables, constraints, indexes, RLS, grants, and ownership protections from the database plan.
- Implement profile lifecycle and account deletion.
- Generate database types and local test fixtures.

### Verification

- Fresh migration/reset repeatability.
- Authentication integration and end-to-end tests.
- Anonymous, owner, cross-user, ownership-mutation, child-parent, and private-schema RLS tests.
- Account-deletion residual-data tests.
- Full Phase 1 quality gates and production build.

### Exit gate

No Spotify OAuth or external music provider calls. Approve Phase 3 separately.

## Phase 3 — Spotify connected account

### Preconditions

- Confirm an available Spotify Development Mode application, owner Premium subscription, and pilot allowlist.
- Re-review current OAuth, endpoint, field, scope, and quota documentation.
- Approve the token-encryption/key-rotation ADR.

### Scope

- Authorization Code with PKCE, state, one-time transactions, exact redirects, and server-side exchange.
- Stable `account_id` linking, encrypted refresh-token storage, atomic refresh/rotation, reauthorization, and disconnect.
- Server-only Spotify client limited to `GET /me`, `GET /search`, `POST /me/playlists`, and `POST /playlists/{id}/items`.
- Private-playlist minimum scope by default; incremental public scope only if approved.
  *(Approved 2026-08-05 for Phase 7. The requested set is now `playlist-modify-private` and `playlist-modify-public`; accounts connected before that change must reauthorize.)*
- Timeout, safe retry, `Retry-After`, `QUOTA_EXCEEDED`, 401/403/429, and redacted error handling.
- Accessible `/settings/connections` experience.

### Verification

- OAuth state/verifier/replay/expiry/open-redirect tests.
- Concurrent token refresh, rotation, revocation, disconnect-race, and insufficient-scope tests.
- Endpoint contract and 429 timing tests.
- Token log/bundle/database-access tests.
- Initial Spotify-to-AI dependency and payload-boundary tests, despite no AI adapter yet.
- Full quality gates and build.

### Exit gate

No AI, recommendations, listening-history ingestion, or deprecated endpoints. Approve Phase 4 separately.

## Phase 4 — Music metadata and discovery providers

### Preconditions

- Accept Last.fm terms for the intended use, storage, attribution, commercial status, and planned AI processing; otherwise approve ListenBrainz and revise scope.
- Confirm MusicBrainz usage/licensing plan and meaningful User-Agent contact.

### Scope

- MusicBrainz artist search, canonical identity, aliases/relationships, and release-group discography.
- Discovery-provider interface with Last.fm adapter for similar artists and tag-based candidates.
- Normalized domain types with explicit provenance.
- Deterministic MusicBrainz reconciliation and Spotify Search resolution with confident/ambiguous/unresolved outcomes.
- Provider-specific rate limiting, timeouts, bounded retries, caching, attribution, and partial-result behavior.

### Verification

- Provider response contract fixtures, malformed response tests, timeout/429/503 tests, MusicBrainz pacing/User-Agent tests.
- Identity matching fixture suite for aliases, punctuation, collisions, missing/stale MBIDs, and ambiguous tracks.
- Persistence tests proving raw Spotify payloads/artwork are not stored.
- Full quality gates and build.

### Exit gate

No AI explanations or mood parsing. Approve Phase 5 separately.

## Phase 5 — AI abstraction and safety boundary

### Preconditions

- Approve which discovery-provider fields may enter AI under that provider's terms.
- Select default AI provider/model aliases and per-user cost/usage limits.

### Scope

- Provider-neutral `AIProvider` interface and OpenAI/Anthropic adapters.
- Structured schemas for mood criteria, explanations, grounded answers, titles, and descriptions.
- Central AI-safe input builder with exact allowlists, provenance validation, forbidden Spotify checks, and payload size limits.
- Timeout, safe retry, provider switching, rate/usage limits, output limits, and deterministic fallback templates.
- Reference completeness checking for factual/explanatory output.

### Verification

- Both adapters pass the same contract suite.
- Compile-time non-assignability tests and dependency-boundary tests.
- Property tests for nested Spotify keys, URIs, URLs, hosts, IDs, tokens, mixed provenance, and oversized input.
- Outbound spy proves zero AI calls for rejected inputs.
- Invalid output, hallucinated-reference, timeout, and fallback tests.
- Full quality gates and build.

### Exit gate

AI layer is safe but not yet a complete user feature. Approve Phase 6 separately.

## Phase 6 — Artist discovery experience

### Scope

- Complete canonical artist selection, relationship results, evidence, confidence, explanations, and save flow.
- Editorial artist pages and accessible result/card/map representations.
- Default, hover, focus, selected, disabled, loading, empty, error, partial, success, and provider-unavailable states.

### Verification

- Unit/integration tests for orchestration and evidence grounding.
- End-to-end canonical selection, ambiguous match, save, partial provider, and keyboard journeys.
- Accessibility audit and visual responsive review.

### Exit gate

Approve Phase 7 separately.

## Phase 7 — Mood discovery and approved playlist creation

### Scope

- Mood form, clarification loop, criteria visualization, deterministic candidate retrieval, candidate edit/reorder, Spotify resolution, and explicit approval.
- Generate title/description before Spotify resolution from approved inputs only.
- Idempotent playlist creation, item batching, partial recovery, and history record.

### Verification

- AI boundary snapshot at every call site.
- Candidate edit, ambiguity, disconnected, insufficient-scope, quota, duplicate-submit, timeout, partial batch, and repair tests.
- Critical end-to-end path with mocked providers and separate manual pilot smoke test only when explicitly configured.
- Accessibility and production build.

### Tracked follow-up: track-selection quality

Phase 7 shipped without a popularity signal, because the only non-Spotify one
available answered `500 — "Popularity API currently disabled due to high load"`
when probed on 2026-08-05, twice. Tracks are therefore the opening tracks of an
artist's studio releases: defensible and fully attributed, but not "their best
tracks", and the interface says which album each came from rather than implying
a ranking it does not have.

**This is not blocking and should not be treated as unfinished Phase 7 work.**
The seam is already in place: track selection sits behind a port with a
MusicBrainz adapter (`lib/mood/track-selection.ts`, consumed by
`features/mood/service.ts`), so adding ListenBrainz popularity is an adapter
plus a ranking step, not a redesign.

Revisit when any of these becomes true:

- the ListenBrainz popularity API (`/1/popularity/top-recordings-for-artist/`)
  starts answering again — re-probe before planning around it;
- ListenBrainz Labs `similar-recordings` proves usable for ranking within an
  artist rather than only from a seed recording;
- listener feedback shows the opening-track heuristic reads as broken rather
  than merely modest.

Spotify's own ordering remains excluded as a ranking source: that decision is
recorded in `docs/product/phase-7-scope.md` and is a compliance position, not a
technical preference.

### Tracked follow-up: general draft resumption

Resuming a draft is implemented for the reconnect round trip only. The two
settings that are not columns on `generated_playlists` — requested length and
explicit-content preference — travel in the return path (`features/mood/resume.ts`),
which is faithful for a round trip the application itself starts and nothing
wider.

Resuming a draft from a bookmark, a draft list, or a session days later would
need those as columns, plus a way to find a draft without already holding its
identifier. Phase 9 owns the library and history surfaces where that belongs.
Adding the columns earlier would be a migration with no consumer.

### Tracked follow-up: remaining AI quota display

Decision 2 of Phase 8 approved showing a listener how much of their daily AI
allowance is left. The limit change itself needed no migration —
`claim_ai_usage` already takes both windows as arguments, so
`perMinuteLimitFor` in `lib/ai/limits.ts` was enough — but *reading* the
remaining count does. `private.ai_usage_events` is not reachable by
`service_role`, and the only functions over it are `claim_ai_usage` and
`purge_ai_usage_events`, neither of which reports a count without consuming a
slot.

A display therefore needs a new `security definer` RPC, and there is no surface
to show it on until the Phase 8 Q&A panel exists. Both land together.

### Tracked follow-up: conversation retention past a five-user pilot

Decision 3 of Phase 8 settled the retention default: `discography_conversations`
and `discography_messages` keep everything, with no TTL, no cap, and no purge
job. Phase 9 owns deletion controls. Keeping only the most recent conversation
per artist was rejected because it destroys history silently, and because Phase 9
should build deletion on top of complete data rather than data with holes
already in it.

**That default is sized for five users and nothing larger.** Growth is genuinely
unbounded, so revisit before any of these:

- the pilot widens beyond the Development Mode allowlist;
- Phase 9 slips far enough that conversations accumulate for months;
- `discography_messages` row counts stop being negligible for a single account.

This is not a privacy gap and should not be recorded as one. RLS isolates
conversations per user, the Phase 2 owner-immutable triggers are in place, and
account deletion cascades — a listener who deletes their account takes their
conversations with them today. What is missing is *selective* deletion, which is
Phase 9's scope, and the retention cost above, which is this note's.

### Tracked follow-up: suggested questions are static

The Q&A panel offers four fixed prompts ("What was their first studio album?",
"Did they release any live albums?", and two more). They are not derived from
what the retrieved records can actually answer, so on a sparse artist a
suggestion can lead straight to an honest refusal — the product suggesting a
question it then declines.

Not wrong, but weaker than it looks: the refusal is correct behaviour, and the
suggestion is what makes it feel like a failure. Deriving them is cheap once the
timeline is in hand — offer the live-album question only when a live release
exists, the decade question only for an artist spanning one — and it is pure
logic over `Discography`, needing no provider call and no schema change.

Worth doing when the Q&A panel is next touched. It is a polish item, not a
correctness one, so Phase 10 is the natural home unless it surfaces earlier.

### Exit gate

Approve Phase 8 separately.

## Phase 8 — Discography exploration and Q&A

### Scope

- Release-group browsing with type/date precision and source links.
- Bounded MusicBrainz retrieval, factual Q&A, citations, conversation persistence, and insufficient-context behavior.

### Verification

- Release classification/date fixtures, pagination/rate tests, grounded-reference validation, fabricated-entity rejection, conversation RLS, E2E, accessibility, and build.

### Exit gate

Approve Phase 9 separately.

## Phase 9 — Library, history, settings, and data rights

### Scope

- Favorites, notes, saved explanations, discovery sessions, generated playlist records, filters, and deletion.
- Privacy/connection settings, data-category transparency, history controls, disconnect, and account deletion completion UX.
- Decide and implement approved retention defaults.

### Verification

- Ownership/RLS regression suite, pagination/filter tests, disconnect and account-deletion end-to-end tests, residual-data inspection, keyboard/accessibility audit, and build.

### Exit gate

Approve Phase 10 separately.

## Phase 10 — Production hardening and private-pilot release

### Scope

- Observability dashboards/alerts, incident runbooks, backups/recovery, provider budgets, cache review, CSP/security headers, dependency and secret scanning.
- Full cross-browser/responsive/accessibility review.
- Privacy notice, provider attribution, terms links, deletion policy, and operational ownership.
- Isolated environments, controlled migrations, deployment and rollback.
- Current-provider documentation and compliance re-review.

### Verification

- Complete formatting, lint, strict type, unit, integration, contract, RLS, auth, security, end-to-end, accessibility, load/limit, and production-build gates.
- Private-pilot manual smoke test with an explicitly configured isolated account.
- No public Spotify-connected launch without the separate access/legal gate.

### Exit gate

Private-pilot go/no-go report. A public launch is a new independently approved phase.

## Cross-phase definition of done

A phase is complete only when:

1. Approved scope and acceptance criteria are implemented.
2. Documentation and environment examples match implementation.
3. Database changes are migrated and RLS-tested.
4. Provider schemas and failure states are covered by mocks/contracts.
5. Security and Spotify AI-boundary controls pass.
6. Accessibility-critical interactions are tested.
7. Exact verification commands and results are reported.
8. Incomplete, blocked, deferred, and unverified work is listed separately.
9. The next phase has not started.

