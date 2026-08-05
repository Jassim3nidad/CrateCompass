# CrateCompass Product Requirements

Status: Phase 0 baseline  
Last reviewed: 2026-08-02  
Owners: Product and Engineering

## Product summary

CrateCompass is an AI-assisted music-discovery application that helps a person move from an artist, a written mood, or a discography question to an understandable and actionable discovery. Its independent value is the explanation of relationships, canonical discography context, deliberate candidate review, and a durable personal discovery library. It is not a playback service or a Spotify replacement.

The first release is a private pilot. Spotify Development Mode is currently limited to a small allowlist and its owner must have Premium. A public Spotify-connected launch is not assumed to be available; the core MusicBrainz and discovery-provider experiences must remain useful without Spotify.

## Target users

- Curious listeners who want to move beyond opaque algorithmic recommendations.
- Music enthusiasts who explore artist relationships and discographies.
- Playlist makers who can describe a setting or feeling more easily than a genre.
- Researchers and collectors who want to save discoveries, evidence, and notes.
- Private-pilot testers with an allowlisted Spotify account who want approved playlists written to their own account.

The product is not targeted at children, businesses, public-performance venues, or automated playlist farms.

## User problems

1. Recommendation services often provide little useful evidence for why two artists relate.
2. Natural-language moods do not map cleanly to fixed genres or provider-specific audio features.
3. Artist names, aliases, editions, release types, and dates are easy to confuse.
4. A promising discovery is easy to lose after the current session.
5. Moving a reviewed set of tracks into a personal streaming account requires repetitive work.
6. Provider outages and ambiguous identity matches are commonly hidden instead of explained.

## Value proposition

CrateCompass separates discovery from fulfillment:

- MusicBrainz establishes canonical identity and discography facts.
- The selected discovery provider supplies similarity and tag evidence.
- Deterministic code ranks and resolves candidates.
- AI interprets only permitted, non-Spotify inputs and explains sourced evidence.
- Spotify is an optional, user-approved destination for search resolution, links, and playlist creation.

The result is transparent, reviewable discovery rather than an unexplained feed.

## MVP features

### Core discovery

- Search MusicBrainz and select a canonical artist.
- Retrieve similar artists from the approved discovery provider.
- Show source attribution, evidence, confidence, and ambiguity.
- Generate an explanation using only user text and approved non-Spotify context.
- Save an artist discovery and an optional personal note.

### Mood discovery

- Convert user-authored mood text into validated, application-owned criteria.
- Ask one focused clarification question when the request is materially ambiguous.
- Retrieve provider-sourced artist or track candidates using tags and deterministic rules.
- Let the user review, include, exclude, and reorder candidates.
- Resolve approved candidates through Spotify Search without sending the results to AI.
- Create a Spotify playlist only after an explicit final confirmation.

### Discography exploration

- Browse MusicBrainz release groups by album, EP, single, and other supported type.
- Answer factual questions only from retrieved MusicBrainz context.
- Present source references and distinguish unknown, incomplete, and conflicting data.

### Personal discovery management

- Save favorite artists, albums, discoveries, explanations, playlist records, and notes.
- View discovery history and prior generated playlists.
- Disconnect Spotify and make stored tokens unusable.
- Delete the CrateCompass account and associated user-owned records.

## Out of scope for the MVP

- Music playback, previews, queue control, or device control.
- Importing Spotify listening history, top items, saved library, or existing playlists.
- Spotify recommendations, related artists, audio features, audio analysis, or editorial playlists.
- Social feeds, follows, messaging, collaborative editing, or public profiles.
- Training, fine-tuning, evaluating, or profiling with Spotify content.
- AI-selected Spotify identity matches or unreviewed playlist creation.
- Mirroring a provider catalog or permanently storing raw Spotify payloads or artwork.
- Uploading, cropping, watermarking, or altering Spotify artwork.
- Native mobile applications, billing, subscriptions, and commercial launch.
- Claims that an explanation is a factual causal account of a user's taste.

## Primary user journeys

### Artist-to-artist discovery

1. The user signs in.
2. The user searches for an artist.
3. CrateCompass returns canonical MusicBrainz candidates.
4. The user selects the correct identity.
5. The discovery provider returns similar artists and evidence.
6. Deterministic matching removes duplicates and flags uncertain identities.
7. The user sees attributed results and optionally requests an explanation.
8. The user saves useful discoveries or opens a resolved result in Spotify.

### Mood-to-playlist

1. The user writes a mood, context, preferences, and exclusions.
2. AI returns validated application criteria or a clarification question.
3. The discovery provider supplies candidates from the criteria.
4. The user reviews and edits the candidate list.
5. If Spotify is connected, the server resolves candidates with confidence labels.
6. The user chooses privacy, title, description, and explicitly approves creation.
7. The server creates the playlist idempotently and adds resolved track URIs.
8. The user receives a Spotify link plus a record in CrateCompass history.

### Discography question

1. The user selects a canonical MusicBrainz artist.
2. The server retrieves a bounded discography context.
3. The user asks a factual question.
4. AI answers only from the supplied context, with release references.
5. Missing or conflicting facts are stated rather than invented.

### Account and data control

1. The user reviews connected providers and stored-data categories.
2. Disconnecting Spotify revokes or invalidates the connection and destroys the stored refresh-token ciphertext.
3. Account deletion requires recent authentication and confirmation.
4. User-owned records are deleted transactionally or queued for verified deletion where an external operation cannot be synchronous.

## Functional requirements

### Identity and access

- **FR-AUTH-01:** Supabase Auth is the only primary application identity provider.
- **FR-AUTH-02:** Email/password sign-up, confirmation, sign-in, sign-out, reset, and session refresh are supported.
- **FR-AUTH-03:** Protected pages deny anonymous access and preserve a safe return destination.
- **FR-AUTH-04:** Spotify connection is optional and cannot create a CrateCompass identity.
- **FR-AUTH-05:** Account deletion requires recent authentication, explicit confirmation, and an auditable outcome without retaining secrets.

### Artist discovery

- **FR-DISC-01:** Artist search begins with MusicBrainz canonical candidates.
- **FR-DISC-02:** Similarity comes from a provider adapter, initially Last.fm.
- **FR-DISC-03:** Every result carries provider attribution and normalized evidence.
- **FR-DISC-04:** Low-confidence or ambiguous matches are never silently selected.
- **FR-DISC-05:** AI explanations cannot add unsupported artists or evidence.
- **FR-DISC-06:** Partial results remain usable when one provider fails.

### Mood and playlists

- **FR-MOOD-01:** Mood input is length-limited and parsed into a Zod-validated schema.
- **FR-MOOD-02:** Mood dimensions are application taxonomy, not Spotify audio-feature values.
- **FR-MOOD-03:** Candidate retrieval is deterministic and provider-attributed.
- **FR-MOOD-04:** Users can remove or reorder candidates before Spotify resolution and creation.
- **FR-PLAY-01:** Playlist creation requires a connected account, sufficient scopes, and explicit approval.
- **FR-PLAY-02:** Creation uses an idempotency key and exposes retryable versus terminal failures.
- **FR-PLAY-03:** Only confidently resolved Spotify track URIs are added automatically.
- **FR-PLAY-04:** Unresolved candidates remain visible and are not fabricated or substituted silently.

### Discography

- **FR-DISCOG-01:** MusicBrainz is the source of canonical artist and release-group facts.
- **FR-DISCOG-02:** Release type, primary/secondary type, date precision, and source reference are retained.
- **FR-DISCOG-03:** Answers cite retrieved context and explicitly identify unavailable facts.
- **FR-DISCOG-04:** Conversation history belongs only to the authenticated user.

### Library and history

- **FR-LIB-01:** Users can save and remove supported application-owned entities.
- **FR-LIB-02:** Saved records retain canonical/provider IDs, display labels, notes, and attribution, not raw provider payloads.
- **FR-HIST-01:** Discovery sessions record input, normalized criteria, status, and timestamps.
- **FR-HIST-02:** History can be deleted by the owner.
- **FR-CONN-01:** Spotify can be connected, reauthorized, and disconnected.
- **FR-CONN-02:** A disconnected connection cannot be refreshed or used.

## Non-functional requirements

- **NFR-01 Availability:** Provider failure must degrade to an honest unavailable or partial-result state; no fabricated fallback data.
- **NFR-02 Performance:** Define and measure server timing budgets per provider before launch; avoid promises without production measurements.
- **NFR-03 Reliability:** External calls use timeouts, bounded retries for safe transient failures, jitter, and provider-specific rate-limit handling.
- **NFR-04 Consistency:** Playlist creation and destructive account operations are idempotent.
- **NFR-05 Maintainability:** Provider response types remain inside their adapters; product logic consumes normalized domain types.
- **NFR-06 Observability:** Structured logs include request and operation identifiers while redacting credentials, tokens, cookies, authorization headers, and sensitive user text.
- **NFR-07 Privacy:** Collect the minimum data needed, document retention, and avoid permanent Spotify catalog storage.
- **NFR-08 Portability:** AI and discovery providers are selected by configuration and conform to provider-neutral interfaces.
- **NFR-09 Quality:** Formatting, linting, strict type-checking, unit, integration, contract, RLS, authentication, accessibility, end-to-end, and production-build checks gate release.
- **NFR-10 Compatibility:** Support the current and previous major versions of evergreen browsers, subject to verification in Phase 10.

## Accessibility requirements

- Target WCAG 2.2 AA.
- Use semantic landmarks, a logical heading outline, named controls, and descriptive validation messages.
- Support the entire core workflow by keyboard without traps.
- Provide visible `:focus-visible` treatment with sufficient contrast.
- Announce loading, success, partial-result, and error changes through appropriate live regions.
- Preserve focus across dialogs, route transitions, errors, and asynchronous updates.
- Respect reduced-motion preferences and avoid motion-dependent meaning.
- Meet text, non-text, focus-indicator, and control-state contrast requirements.
- Keep touch targets and mobile layouts usable without horizontal overflow at 320 CSS pixels.
- Test dialogs, menus, comboboxes, forms, skeletons, and provider-status messages with assistive technology semantics.

## Security requirements

- Enforce strict server/client module boundaries for secrets and provider credentials.
- Validate user inputs, route parameters, external responses, AI outputs, and persisted JSON with explicit schemas.
- Enable and test RLS on every user-owned table.
- Scope every user-owned operation to the authenticated Supabase user; never trust a submitted owner ID.
- Encrypt Spotify refresh tokens with an application-managed, versioned key outside the database.
- Keep access tokens ephemeral and server-only; never log either token type.
- Protect OAuth with exact redirect matching, state, PKCE, short-lived transaction storage, and replay prevention.
- Apply CSRF protection or same-origin controls to state-changing endpoints and require recent authentication for destructive actions.
- Rate-limit authentication, AI, search, playlist creation, and deletion operations.
- Use restrictive browser headers, safe redirect allowlists, dependency scanning, and secret scanning.
- Record security-relevant events without storing credentials or raw provider payloads.
- Enforce the Spotify-to-AI prohibition through types, runtime allowlists, provenance, serialization guards, and automated negative tests.

## Provider dependencies

| Provider | MVP responsibility | Authentication | Stored data | Required degradation |
| --- | --- | --- | --- | --- |
| Supabase | Auth, PostgreSQL, RLS | User session; server-only privileged key where unavoidable | Application-owned user records | Read-only public shell or sign-in unavailable state |
| MusicBrainz | Canonical artist identity and discography | No key for reads; meaningful User-Agent required | Canonical IDs and bounded normalized metadata | Explain unavailable canonical/discography data |
| Last.fm | Similar artists, tags, mood candidates, evidence | Server-side API key; no end-user auth for selected reads | Bounded normalized evidence under reviewed terms | Disable discovery result generation; never invent candidates |
| ListenBrainz | Planned alternate discovery adapter | Optional token; rate-limit headers | None in MVP | Not active in MVP |
| Spotify | Account connection, search resolution, links, approved playlist creation | Authorization Code with PKCE | Stable account ID, encrypted refresh token, scopes, operational resource IDs | All non-Spotify discovery remains usable |
| OpenAI or Anthropic | Mood parsing, sourced explanation, grounded Q&A, title/description | Server-side API key | Usage metadata and approved outputs only | Deterministic templates or honest unavailable state |
| Vercel | Deployment and server runtime | Deployment credentials | Runtime/configuration metadata | Document incident and rollback procedure |

## Risks and assumptions

| Risk or assumption | Impact | Mitigation or decision gate |
| --- | --- | --- |
| Spotify Development Mode supports only a private pilot | Public playlist integration may be unavailable | Treat Spotify as optional; validate five-user pilot; require separate approval before public-launch claims |
| Extended quota eligibility is not assured | Commercial launch may be blocked | Preserve provider-independent value; obtain organizational/legal review early |
| Spotify endpoints and response fields change | Runtime or matching failures | Contract tests, schema tolerance, change-log review before each release |
| Last.fm commercial and AI-processing rights require confirmation | Discovery or explanation scope may need change | Legal/terms review before commercial use or AI ingestion; keep ListenBrainz adapter path |
| Last.fm MBIDs may be absent or stale | Ambiguous identity matching | Re-resolve through MusicBrainz; confidence thresholds and user selection |
| MusicBrainz data can be incomplete or conflicting | Discography answers may be incomplete | Preserve date precision and source references; explicitly state uncertainty |
| AI can produce unsupported prose | User trust and factuality risk | Structured schemas, bounded context, citation checks, deterministic fallback |
| Third-party services can rate-limit or fail | Partial workflows | Centralized budgets, cache only when permitted, queue/retry safe operations, honest states |
| Encryption-key rotation is operationally complex | Token loss or exposure | Version ciphertext, test rotation, maintain revocation/reconnect recovery |
| Account deletion spans external and internal systems | Incomplete erasure risk | Transactional internal deletion, token destruction, verified async job only when required |

## MVP acceptance criteria

The MVP is acceptable only when:

1. A private-pilot user can authenticate independently of Spotify.
2. Canonical artist search and sourced similar-artist discovery work without a Spotify connection.
3. Mood criteria and every AI response pass strict schemas.
4. Automated tests prove Spotify-originated content is rejected before any AI adapter call.
5. Ambiguous external identities are not silently resolved.
6. A connected allowlisted user can approve and create a playlist, private or public at their choice, with current endpoints and no scope beyond the two playlist-modification scopes.
7. Disconnect makes future refresh impossible and account deletion removes user-owned records.
8. RLS tests deny anonymous and cross-user access.
9. All required interface states and critical keyboard workflows are verified.
10. Formatting, lint, strict type-check, automated test suites, accessibility checks, and production build pass.
11. Provider attribution, Spotify links, privacy notice, and terms-dependent behavior are present.
12. No real Spotify account is used by automated tests.

## Success metrics

Targets will be set after an instrumented pilot baseline; no usage values are assumed in advance. The MVP will measure:

- Percentage of artist searches that result in an explicit canonical selection.
- Candidate identity-resolution distribution: confident, ambiguous, and unresolved.
- Percentage of discovery sessions with at least one saved result.
- Percentage of mood sessions that require clarification and that continue afterward.
- Playlist review-to-approval and approval-to-success conversion rates.
- Provider error, timeout, partial-result, retry, and recovery rates.
- Discography answers with complete source references and validation success.
- Spotify-to-AI boundary rejection count; any successful prohibited transfer is a release-blocking incident.
- Cross-user RLS test pass rate and destructive-operation verification rate.
- Accessibility defect count by severity and completion rate for critical keyboard journeys.
- User-reported usefulness of explanations and control over recommendations, gathered with an optional post-session question.

## Product decision gates

- **Before Phase 3:** confirm availability of a Spotify Development Mode app, Premium owner, and pilot allowlist.
- **Before Phase 4:** accept Last.fm terms for the intended private pilot or select ListenBrainz.
- **Before Phase 5:** confirm which non-Spotify provider fields may be sent to the selected AI provider.
- **Before public launch:** complete Spotify access, legal, privacy, security, accessibility, and operational reviews.

