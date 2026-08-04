# Spotify Compliance Plan

Status: Phase 3 pre-implementation re-review; not legal advice  
Last reviewed: 2026-08-04 (Phase 0 baseline: 2026-08-02)

## Executive conclusion

The proposed architecture can support a compliant private-pilot integration if the controls in this document are implemented and tested. Spotify is limited to optional account connection, deterministic search resolution, attributed links/display, and user-approved playlist creation. It is not a discovery or AI evidence source.

A public Spotify-connected launch is not assumed feasible. Current Development Mode is limited to five allowlisted authenticated users and requires the app owner to have Premium. Extended access currently has organizational and scale requirements that CrateCompass cannot claim to meet during a new-project Phase 0.

## Current platform baseline

Reviewed official sources:

- Developer Policy, effective May 15, 2025: <https://developer.spotify.com/policy>
- Developer Terms: <https://developer.spotify.com/terms>
- Quota modes: <https://developer.spotify.com/documentation/web-api/concepts/quota-modes>
- July 23, 2026 Development Mode quota update: <https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates>
- February 2026 Development Mode migration guide: <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- Redirect URI requirements: <https://developer.spotify.com/documentation/web-api/concepts/redirect_uri>
- Current-user profile: <https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile>
- Create Playlist: <https://developer.spotify.com/documentation/web-api/reference/create-playlist>
- Add Items to Playlist: <https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist>
- Rate limits: <https://developer.spotify.com/documentation/web-api/concepts/rate-limits>

Added during the 2026-08-04 Phase 3 re-review:

- Authorization Code with PKCE: <https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow>
- Refreshing tokens: <https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens>
- Scopes: <https://developer.spotify.com/documentation/web-api/concepts/scopes>
- Add Items to Playlist: <https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist>

This review must be repeated before Phase 3 implementation and before every production release.

## Phase 3 re-review findings (2026-08-04)

The pre-implementation re-review required above was performed against the sources listed. Seven findings changed or confirmed the design.

1. **`GET /me` exposes `account_id` as the immutable linking identifier.** The response documentation marks `account_id` as the stable value for account linking and explicitly advises against using `id` for that purpose. `public.spotify_connections.spotify_user_id` therefore stores `account_id`. The Phase 0 wording ("stable `account_id`") is confirmed correct; the implementation must not substitute `id`.

2. **`GET /me` needs no scope for the fields CrateCompass uses.** `display_name`, `id`, `uri`, and `external_urls` return without any scope. Every field gated behind `user-read-email` or `user-read-private` — `email`, `country`, `product`, `explicit_content` — is now marked **deprecated** in Spotify's own reference. The minimum-scope decision to request neither scope is confirmed and is now additionally supported by deprecation, not only by data minimisation. `followers` is likewise deprecated and unused.

3. **Refresh tokens expire after six months.** Confirmed in the refreshing-tokens documentation and displayed in the app dashboard as `Refresh Token Lifetime: 180 days`. The lifetime starts at user authorization and is **not** extended by exchanging the token. This is a distinct failure mode from access-token expiry and from user revocation, and requires its own reconnect state in the UI. Phase 0 did not anticipate it.

4. **Refresh-token rotation is optional, not guaranteed.** Spotify states that when a refresh token is not returned, the existing token continues to be used. Persistence logic must treat a missing `refresh_token` in a refresh response as success-without-rotation, never as an error or as a null overwrite.

5. **PKCE and client-secret authentication are mutually exclusive.** Spotify's PKCE tutorial documents `client_id` + `code_verifier` on the token request and no client secret; the confidential Authorization Code flow uses HTTP Basic instead. Combining them is undocumented. Recorded as [ADR 0002](../architecture/adr/0002-spotify-oauth-flow.md), which selects PKCE and leaves `SPOTIFY_CLIENT_SECRET` unused.

6. **Rate and quota limits are two separate mechanisms.** Rate limiting is a rolling **30-second** window returning 429 with `Retry-After` in **seconds**. Quota limiting is separate, applies per endpoint bucket in Development Mode, and returns 429 with reason `QUOTA_EXCEEDED`. The July 2026 quota update added a `reason` field to 429 responses precisely so the two can be told apart, and moved quota accounting from per-app to **per-developer-account**, so every Development Mode app under one account draws from a shared budget. Specific numeric thresholds are not published and must not be hard-coded.

7. **Endpoint and redirect baselines are unchanged.** `POST /me/playlists` and `POST /playlists/{playlist_id}/items` are current; `POST /playlists/{playlist_id}/tracks` carries an explicit deprecation notice directing callers to the `/items` endpoint. Maximum 100 URIs per add request. `localhost` remains prohibited as a redirect URI and loopback literals such as `http://127.0.0.1:PORT` remain permitted over HTTP. Development Mode remains capped at 5 allowlisted users and requires the app owner to hold Premium.

8. **The February 2026 migration confirms the four-endpoint baseline by elimination.** Every Spotify surface this project already declined to use has since been removed outright for Development Mode apps: `GET /artists/{id}/top-tracks`, `GET /browse/new-releases`, `GET /browse/categories`, the batch catalog fetches, `GET /users/{id}`, `GET /users/{id}/playlists`, and `POST /users/{user_id}/playlists`. The Phase 0 prohibited-dependency list needs no revision — the platform enforces it. Two consequences do reach the implementation:

   - **`GET /search` now caps `limit` at 10, default 5** (previously 50 and 20). The client's search method must default to a caller-supplied bound no greater than 10 and paginate by `offset` rather than raising `limit`.
   - **The removed `GET /me` fields are gone, not merely deprecated** — `country`, `email`, `explicit_content`, `followers`, and `product` are no longer returned. The `/me` response schema must treat their absence as normal and must not mark them optional-but-expected.

   The migration guide documents **no OAuth or token changes**; existing authorization flows are unaffected.

### Conflict resolved

The "Storage and caching" section below previously stated that CrateCompass does not persist access tokens, while the Phase 2 schema defines `private.spotify_credentials.access_token_ciphertext` as `not null`. These could not both hold. [ADR 0001](../architecture/adr/0001-spotify-token-encryption.md), approved 2026-08-04, keeps the schema and persists the access token as AEAD ciphertext under the same controls as the refresh token. The storage rules below are corrected accordingly.

## Product-positioning boundary

CrateCompass must add independent value and must not mimic or replace Spotify's core experience. Independent value consists of:

- MusicBrainz-grounded identity and discography exploration.
- Third-party, attributed artist relationships.
- User-authored mood interpretation using application taxonomy.
- Transparent evidence and confidence states.
- Personal notes, saved discoveries, and history.
- A review step before exporting an approved result to Spotify.

The product must not imply Spotify endorsement, partnership, or co-branding. It is not targeted at children or business/public-performance use.

## AI prohibition

Spotify policy prohibits using Spotify Platform or Spotify Content to train or otherwise ingest into an AI or machine-learning model. CrateCompass applies the broader operational rule that no Spotify-originated value may enter any AI call, including inference, prompt construction, embeddings, evaluation, moderation performed by an ML provider, profiling, or fallback routing.

Prohibited inputs include:

- Raw or normalized Spotify API responses.
- Artist, album, track, playlist, user, image, cover-art, playback, library, history, recommendation, or audio-feature data from Spotify.
- Spotify IDs, URIs, URLs, hosts, scopes, tokens, and playlist payloads.
- Text derived from or summarizing Spotify content.
- Mixed input whose provenance is absent or includes Spotify.

Permitted AI inputs are limited to user-authored text, application-owned taxonomy, MusicBrainz context, and separately approved non-Spotify discovery evidence whose provider terms permit the processing.

Enforcement requires independent AI-safe types, runtime exact-schema parsing, approved provenance, recursive forbidden-value checks, dependency rules, logging controls, and tests asserting zero outbound AI requests for rejected payloads.

## Endpoint compliance

### Allowed baseline

| Purpose | Current endpoint | Constraints |
| --- | --- | --- |
| Identify connected account | `GET /me` | Persist stable `account_id`; do not request deprecated private fields |
| Resolve selected candidates | `GET /search` | Maximum 10 results per Development Mode request; paginate sparingly |
| Create current user's playlist | `POST /me/playlists` | Explicit approval and idempotency required |
| Add approved items | `POST /playlists/{playlist_id}/items` | Maximum 100 URIs per request; bounded batching |

### Prohibited/deprecated dependencies

CrateCompass does not use:

- Related Artists.
- Recommendations.
- Audio Features or Audio Analysis.
- Featured or category playlists.
- Spotify-owned editorial/algorithmic playlists as discovery inputs.
- `POST /users/{user_id}/playlists`.
- Legacy playlist item paths ending in `/tracks`.
- Artist top tracks, browse new releases, batch catalog fetches, or unavailable response fields as required product inputs.

The Spotify client uses an endpoint allowlist so accidental addition requires an explicit review.

## OAuth and scopes

### Flow

- A user signs in to CrateCompass through Supabase before linking Spotify.
- Use Authorization Code with PKCE, high-entropy state, an exact registered redirect URI, short-lived user-bound transaction state, and one-time callback consumption.
- Token exchange and refresh occur server-side.
- Production redirects use HTTPS. Local development uses an explicit loopback IP such as `http://127.0.0.1:3000`; `localhost` is not registered.
- Per [ADR 0002](../architecture/adr/0002-spotify-oauth-flow.md), the PKCE flow is used and the Spotify client secret is not read by application code at all. It cannot reach the browser because nothing reads it.

### Minimum-scope strategy

- Default MVP playlist creation is private and requests `playlist-modify-private` only.
- If the user-facing product later supports creating public playlists, request `playlist-modify-public` through explicit incremental reauthorization before that operation.
- Do not request `user-read-email` or `user-read-private`; CrateCompass does not need the deprecated email, country, product, or explicit-content fields.
- Do not request top-item, playback, recently-played, saved-library, follow, or streaming scopes.
- Store and display granted scopes and fail with a clear reconnect flow when insufficient.

The minimum-scope decision is revalidated against current endpoint documentation during Phase 3.

## Token handling

- Persist refresh tokens only as authenticated, versioned ciphertext in a private, non-exposed database schema.
- Keep encryption keys in deployment secret management, outside PostgreSQL.
- Keep access tokens server-only and short-lived, at rest only as versioned ciphertext in the same private-schema row as the refresh token, never beyond `token_expires_at`.
- Redact OAuth codes, verifiers, authorization headers, cookies, access tokens, refresh tokens, and ciphertext from logs/errors.
- Atomically handle refresh-token rotation and concurrent refresh.
- Handle 401 as expired/invalid authorization, 403 as access/scope/allowlist recovery, and 429 according to rate/quota semantics.
- On disconnect, block refresh first and destroy ciphertext even if a provider-side revocation operation is unavailable or fails.

## Rate and quota handling

- Development Mode is designed as a private pilot with no more than the currently permitted allowlisted users.
- The owner-Premium requirement is a documented operational dependency.
- All Development Mode client IDs share the developer account's quota under the July 2026 update.
- On 429, distinguish a response reason of `QUOTA_EXCEEDED` from rolling-window rate limiting and honor `Retry-After` when provided.
- Apply bounded retry only when safe, with jitter and no retry storm.
- Coalesce searches, cache only where permitted, paginate sparingly, and trigger expensive work from explicit user actions.
- Do not circumvent quotas, rotate client IDs to evade limits, or silently degrade into prohibited endpoints.

## Storage and caching

Allowed persistent Spotify fields are limited to:

- Stable connected `account_id`.
- Connection state, granted scopes, and timestamps.
- Encrypted refresh token, encrypted access token, and key version in the private schema.
- Spotify playlist ID created for the user.
- Spotify resource IDs/URIs only when operationally necessary.

CrateCompass does not:

- Mirror the Spotify catalog.
- Store raw Spotify response bodies.
- Persist access tokens anywhere other than the encrypted private-schema credential row, or beyond the expiry recorded in `token_expires_at`.
- Download or rehost Spotify artwork.
- Persist full playlist contents.
- Use Spotify data to build user profiles or derived listening metrics.

Any short-lived Spotify resolution cache must be isolated from AI, TTL-bound, purpose-limited, and reviewed against current caching requirements.

## Display, artwork, and attribution

- Spotify-supplied metadata is visibly attributed to Spotify.
- Metadata and artwork are accompanied by a link to the applicable Spotify content.
- Spotify content is not offered as a standalone data product.
- Artwork is rendered from the provider-supplied URL only when permitted; it is not downloaded, rehosted, cropped, filtered, overlaid, watermarked, or otherwise altered.
- Image layouts preserve aspect ratio and do not use Spotify artwork as application-owned branding.
- Spotify marks follow current branding guidelines and do not imply endorsement.
- If current display requirements cannot be satisfied, omit the Spotify content and present the provider-neutral discovery instead.

## Playlist creation controls

- Candidate generation occurs independently of Spotify.
- Spotify search resolves only user-reviewed candidates through deterministic matching.
- AI never chooses among Spotify search results.
- Ambiguous matches require user selection; unresolved matches are omitted with explanation.
- The UI shows the final title, description, visibility, and resolved items before explicit approval.
- An idempotency record prevents duplicate playlists after retries or timeouts.
- If playlist creation succeeds but adding some items fails, preserve the playlist ID and repair that playlist rather than creating another.
- Automated tests use mocked Spotify responses and synthetic credentials only.

## User transparency and control

The connection UI explains:

- Spotify is optional and separate from the CrateCompass account.
- Exactly what scopes are requested and why.
- Which identifiers and encrypted credential are stored.
- Spotify data is never sent to AI.
- Disconnecting stops future Spotify access by destroying local token usability.
- Deleting a CrateCompass record does not necessarily delete a playlist already created in Spotify.
- Account deletion removes applicable application-owned records.

Provide accessible states for connecting, connected, insufficient scope, expired, revoked, Development Mode denial, quota exhausted, disconnecting, disconnected, and provider unavailable.

## Compliance verification matrix

| Requirement | Design control | Required evidence before release |
| --- | --- | --- |
| No Spotify-to-AI transfer | Isolated types, allowlist gateway, provenance, runtime rejection | Compile, property, integration, and outbound-spy tests |
| No deprecated discovery dependencies | Spotify endpoint allowlist | Contract test and repository scan |
| Current playlist endpoints | `/me/playlists` and `/items` client methods | Request contract tests |
| Minimum scopes | Private-by-default incremental scope design | OAuth URL and insufficient-scope tests |
| Secure auth | Code + PKCE, state, exact redirects, server exchange | Tamper/replay/redirect tests |
| Token secrecy | Private schema, encryption, redaction | DB grant, bundle, log, rotation tests |
| No catalog mirroring | Minimal schema and TTL cache | Schema review and persistence tests |
| Artwork integrity/attribution | Provider URL, link, mark, no transform/download | Component and code-search tests |
| Rate/quota compliance | Retry-After, quota reason, budgets | 429 simulations |
| Disconnect/deletion | Stop-use-first and ciphertext destruction | Race and residual-data tests |
| Independent value | Provider-neutral discovery and discography | Product/UX acceptance review |

## Launch gates

### Private pilot

- Spotify app and owner Premium status confirmed.
- Every tester is allowlisted.
- Privacy notice and terms links are available.
- Current endpoints/scopes pass contract tests.
- Spotify-to-AI, token, RLS, disconnect, and playlist idempotency tests pass.

### Public Spotify-connected release

- Spotify extended access or another explicit authorized basis is confirmed in writing/account status.
- Organization and scale requirements are reviewed against current rules.
- Legal review covers Spotify, Last.fm/ListenBrainz, MusicBrainz, AI providers, privacy, and international processing.
- Security, accessibility, incident response, deletion, monitoring, and capacity reviews pass.

Without the public-release gate, ship only a private pilot or a provider-neutral experience that opens ordinary Spotify links without connected-account operations where permitted.

