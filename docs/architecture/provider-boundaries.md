# Provider Boundaries

Status: Phase 0 baseline  
Last reviewed: 2026-08-02

## Purpose

This document defines what each external provider may supply, what CrateCompass may retain, and which information may cross into the AI layer. These are security and compliance boundaries, not coding conventions.

## Boundary rules

1. Every external fact has an explicit provenance value.
2. Raw provider responses are private to their server-only adapter.
3. Application services receive normalized domain models with only required fields.
4. Spotify-derived values use separate nominal types and can never implement an AI-safe input type.
5. AI input is built through one gateway from an allowlist; arbitrary objects and provider payloads are rejected.
6. Cross-provider identity matching is deterministic and auditable.
7. Provider terms, not technical convenience, determine caching and persistence.

## Responsibility matrix

| Capability | Source of truth | May be persisted | May enter AI | Notes |
| --- | --- | --- | --- | --- |
| Application identity | Supabase Auth | User ID and application profile | No auth/session data | Spotify is not an identity provider for CrateCompass |
| Canonical artist identity | MusicBrainz | MBID, name, aliases needed for matching | Yes, bounded normalized context | Preserve MusicBrainz source reference |
| Discography facts | MusicBrainz | Normalized release references as needed | Yes, bounded retrieved context | AI must answer only from supplied facts |
| Similar artists | ListenBrainz (ADR 0003) | Bounded MBIDs, names, scores, attribution, retrieval time | Yes — CC0 listen data carries no sub-licensing bar | No raw payloads |
| Mood/tag candidates | ListenBrainz (ADR 0003) | Bounded normalized evidence | Yes | ListenBrainz has no direct tag-to-artist equivalent; Phase 7 scope narrows accordingly |
| Spotify identity and links | Spotify | Stable account ID; operational resource IDs/URIs | Never | Display with Spotify attribution and deep link |
| Spotify metadata/artwork | Spotify | No permanent catalog mirror; no downloaded artwork | Never | Fetch/display under current policy and caching rules |
| Spotify access/refresh tokens | Spotify OAuth | Refresh token only as versioned ciphertext; ephemeral access token | Never | Server-only and redacted |
| AI outputs | OpenAI/Anthropic | Validated application output if useful | N/A | Store provider/model version and validation status, not hidden reasoning |
| User-authored text | User | As required by the feature and retention controls | Yes | Apply length limits, privacy notice, and redaction from logs |

## Provider ports

### MusicBrainz

Allowed operations:

- Search artists and retrieve canonical artist details.
- Retrieve aliases, external relationships needed for deterministic identity matching, release groups, and release dates.
- Retrieve bounded context for discography questions.

Requirements:

- Server-side requests with a meaningful application/version/contact User-Agent.
- Central pacing at one request per second unless a separate agreement applies.
- Preserve incomplete date precision and release-type distinctions.
- Do not treat missing community data as proof of absence.

### Discovery provider

The product depends on a neutral `DiscoveryProvider` interface rather than Last.fm directly:

```ts
interface DiscoveryProvider {
  findSimilarArtists(input: SimilarArtistsInput): Promise<ArtistCandidate[]>;
  findArtistsByTags(input: TagArtistInput): Promise<ArtistCandidate[]>;
  findTracksByTags(input: TagTrackInput): Promise<TrackCandidate[]>;
}
```

Last.fm is recommended for the private-pilot MVP because it exposes direct similar-artist and tag discovery, accepts an MBID for similar-artist lookups, returns useful names for deterministic Spotify search, and does not require end-user authentication for the selected read methods.

ListenBrainz remains the planned alternate because it is MBID-oriented, publishes rate-limit headers, and is aligned with the MusicBrainz ecosystem. Before Phase 4, confirm Last.fm use, storage, attribution, commercial status, and any AI subprocessing. If not accepted, switch the adapter decision to ListenBrainz and narrow the mood workflow to supported endpoints.

#### MVP source comparison

| Criterion | Last.fm | ListenBrainz | MVP assessment |
| --- | --- | --- | --- |
| Similar-artist support | Direct `artist.getSimilar` read method with a similarity score; accepts artist name or MBID | Similar-artist and recommendation data exists, with stronger MBID orientation, but parts of the recommendation surface are documented as experimental or organized around ListenBrainz data generation/personalization | Last.fm is the more direct anonymous seed-artist fit |
| Mood and tag discovery | Direct global tag, similar-tag, tag-to-artist, and tag-to-track methods | No equally direct general-purpose mood/tag discovery surface was confirmed for this workflow | Last.fm better matches the MVP mood retrieval design |
| API reliability | Documents provider error codes including offline, temporary failure, and rate limiting; no public SLA was confirmed | Documents 429 behavior and rate-limit headers; no public SLA was confirmed | Neither receives an assumed uptime advantage; instrument both and degrade gracefully |
| Documentation | Method-by-method API documentation with examples and error codes | Comprehensive project documentation, OpenAPI reference link, rate-limit and authentication documentation | Both are usable; adapter contract tests remain required |
| Authentication | Server API key required; selected read methods require no end-user session | Many reads are available without a user token; valid tokens may receive higher limits and private/user operations require them | Both can support a server-mediated read path; Last.fm needs a protected project key |
| Rate limits | Provider-controlled and not presented as a fixed public allowance; error 29 indicates limit exceeded | Response headers publish current limit, remaining requests, and reset timing; 429 on excess | ListenBrainz is operationally clearer |
| Licensing and terms | Limited terminable license, attribution/link requirements, storage/caching conditions, and prior contact requested for commercial/research use | Listen data is described as CC0; the terms and provenance of each derived API output still require review | ListenBrainz is clearer for open listen data; Last.fm is a blocking legal/terms gate before commercial or AI use |
| Mapping to Spotify | Artist/track names are directly usable in search and results may include MBIDs | MBIDs provide strong canonical joins but may require an extra MusicBrainz lookup to obtain search names/credits | Last.fm is simpler for the initial resolver; neither may bypass confidence thresholds |

**Decision superseded.** The Phase 4 terms gate ran on 2026-08-04 and selected **ListenBrainz**, not Last.fm. See [ADR 0003](adr/0003-discovery-provider-selection.md) for the Last.fm terms findings — principally the prohibition on sub-licensing Last.fm Data to a third party, which makes transmitting similarity evidence to an AI provider legally ambiguous — and for the Labs dataset-hoster stability caveat that came with the ListenBrainz choice.

The comparison table above is retained as the Phase 0 record. Two of its judgements did not survive contact with the terms and the live endpoints: Last.fm's "more direct anonymous seed-artist fit" was outweighed by its licensing constraints, and ListenBrainz's similar-artist data proved **MBID-native**, which makes cross-provider matching simpler rather than harder as the table assumed.

Keep the provider port free of provider-specific response types so the source can be replaced without changing product services. Do not claim comparative uptime without measured production evidence.

### Spotify

Allowed responsibilities:

- OAuth account connection and current-user account identification.
- Catalog search to resolve already selected external candidates.
- Display of current Spotify metadata with attribution and links.
- Creation of a user-approved playlist.
- Addition of resolved Spotify track URIs.
- Opening content in Spotify.

Forbidden responsibilities:

- Similar-artist or mood recommendation generation.
- Audio-feature or audio-analysis based discovery.
- Supplying prompts, context, embeddings, evaluation sets, profiles, or labels to AI.
- Automatic identity arbitration by AI.
- Permanent catalog mirroring, artwork rehosting, or artwork alteration.
- Use of listening history, top items, saved library, playback, or existing playlists in the MVP.

Current endpoint baseline for Development Mode:

- `GET /me` for the stable `account_id` and display fields.
- `GET /search` with at most 10 results per request.
- `POST /me/playlists` to create a playlist.
- `POST /playlists/{playlist_id}/items` to add up to 100 item URIs per request.

Do not use legacy `/users/{user_id}/playlists` or `/playlists/{id}/tracks` paths.

### AI provider

Allowed inputs:

- User-authored mood, question, preference, exclusion, and naming text.
- Application-owned mood taxonomy and deterministic thresholds.
- Bounded MusicBrainz-derived context.
- Bounded discovery evidence only after its provider terms allow the intended processing.

Forbidden inputs include:

- Any Spotify API response or normalized derivative.
- Spotify artist, album, track, playlist, image, profile, history, or recommendation data.
- Spotify URLs, URIs, IDs, artwork hosts, access tokens, refresh tokens, scopes, or payload keys.
- Mixed objects whose provenance is missing or contains Spotify.
- Provider credentials, Supabase sessions, cookies, authorization headers, encryption keys, and logs.

## Spotify-to-AI enforcement

### Type-level separation

- Brand Spotify values as `SpotifyId`, `SpotifyUri`, and `SpotifyDerived<T>`.
- Define AI-safe types independently with exact properties and approved provenance unions.
- Do not use broad maps, `unknown` forwarding, index signatures, raw JSON, or type assertions at the AI boundary.
- Place Spotify modules and AI modules in separate dependency-tree branches.

### Runtime enforcement

The AI input gateway must:

1. Parse an exact Zod schema that strips nothing silently and rejects unknown fields.
2. Require approved provenance on every external fact.
3. Recursively reject keys such as `spotify`, `spotifyId`, `spotifyUri`, `href`, `external_urls`, `images`, `access_token`, and `refresh_token`.
4. Reject Spotify URI schemes and known Spotify/API/image hosts in all strings.
5. Reject credential patterns and unexpectedly large input.
6. Serialize only the parsed result, never the caller's original object.
7. Emit a redacted security event when rejection occurs.

### Test enforcement

- Compile-time tests prove Spotify types are not assignable to AI input types.
- Unit/property tests inject forbidden keys and strings at arbitrary nesting depths.
- Integration tests spy at each AI adapter and assert that rejected input causes zero outbound calls.
- Log-capture tests assert that tokens and Spotify payloads do not appear in logs or errors.
- Dependency tests fail when AI modules import Spotify adapter modules or vice versa.
- Fixtures are synthetic or provider-approved; automated tests never use a real Spotify account.

## Deterministic cross-provider matching

Matching is a product service outside AI and provider adapters. It may use:

- Exact canonical name.
- Normalized aliases and punctuation.
- MusicBrainz IDs and approved external identifiers.
- Artist type and country when available from MusicBrainz.
- Track title, credited artist set, and version qualifiers.
- Explicit confidence thresholds and tie detection.

Outcomes are `confident`, `ambiguous`, or `unresolved`. Only `confident` results may be automatically included after user review; ambiguous results require selection, and unresolved results remain unresolved.

## Logging boundary

Provider clients log operation name, provider, duration, status class, retry count, quota reason, and correlation ID. They do not log request authorization, OAuth codes, tokens, raw response bodies, full user prompts, playlist contents, or Spotify metadata. Development debugging does not weaken this rule.

## Source references

- Spotify Developer Policy: <https://developer.spotify.com/policy>
- Spotify February 2026 migration guide: <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- Last.fm similar artists: <https://www.last.fm/api/show/artist.getSimilar>
- Last.fm API terms: <https://www.last.fm/api/tos>
- ListenBrainz API: <https://listenbrainz.readthedocs.io/en/latest/users/api/index.html>
- MusicBrainz API: <https://musicbrainz.org/doc/MusicBrainz_API>
