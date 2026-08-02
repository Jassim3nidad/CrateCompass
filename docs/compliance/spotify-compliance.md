# Spotify Compliance Plan

Status: Phase 0 architecture review; not legal advice  
Last reviewed: 2026-08-02

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

This review must be repeated before Phase 3 implementation and before every production release.

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
- The Spotify client secret, if used by the confidential server flow, is never sent to the browser.

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
- Keep access tokens ephemeral and server-only.
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
- Encrypted refresh token and key version in the private schema.
- Spotify playlist ID created for the user.
- Spotify resource IDs/URIs only when operationally necessary.

CrateCompass does not:

- Mirror the Spotify catalog.
- Store raw Spotify response bodies.
- Persist access tokens.
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

