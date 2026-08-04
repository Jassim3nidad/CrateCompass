# ADR 0003 — Discovery provider selection

Status: Accepted 2026-08-04  
Date: 2026-08-04  
Phase: 4 precondition  
Supersedes: the Last.fm recommendation in `docs/architecture/provider-boundaries.md`

## Context

Phase 0 recommended Last.fm for the private-pilot MVP, conditional on a terms gate at Phase 4. That gate is this ADR.

### Last.fm terms review (2026-08-04)

Reviewed <https://www.last.fm/api/tos>:

| Term | Consequence for CrateCompass |
| --- | --- |
| Non-commercial by default; commercial use requires a separate agreement | A future monetisation decision becomes a second, external gate |
| 100 MB "Reasonable Usage Cap" on stored data | Not binding at pilot scale |
| Caching must follow the HTTP headers sent with responses | Implementable |
| Attribution: credit Last.fm, link to its catalogue pages, display the "powered by AudioScrobbler" button, with placement approved in writing | Implementable, but adds a written-approval dependency |
| **Sub-licensing Last.fm Data to a third party is prohibited** | The blocking issue |
| Last.fm may terminate at any time, after which all Last.fm Data must be deleted | Continuity risk for a product built around the data |

The terms contain **no explicit clause about machine learning or AI processing**, permitting or prohibiting. The difficulty is the sub-licensing prohibition: transmitting similarity evidence to OpenAI or Anthropic is a disclosure to a third party, and whether that constitutes prohibited sub-licensing is genuinely ambiguous on the text as written.

Phase 5's `explainArtistMatch` is built on exactly that transmission. Phases 6 and 7 then build on Phase 5. Adopting Last.fm would place the central architectural commitment of this product on an ambiguous reading of a clause whose owner may terminate access at will.

### ListenBrainz review

Reviewed <https://listenbrainz.readthedocs.io/en/latest/users/api/index.html> and the Labs dataset hoster:

- Listen data is CC0, which removes the sub-licensing question entirely.
- Rate limiting is published through `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset-In` and `X-RateLimit-Reset` headers, with 429 on excess. No fixed public allowance, so clients adapt to the headers rather than to a hard-coded number.
- A user token is optional for reads and may raise limits.
- Similar artists are served by the Labs dataset hoster at `https://labs.api.listenbrainz.org/similar-artists/json`, verified live on 2026-08-04. The response is a flat array of objects with `artist_mbid`, `name`, `comment`, `type`, `gender`, `score` and `reference_mbid`.

## Decision

**Use ListenBrainz as the Phase 4 discovery provider. Do not integrate Last.fm.**

Reasons, in order of weight:

1. CC0 listen data leaves Phase 5 unconstrained. No later legal finding can force a rebuild of the discovery layer.
2. Results are **MBID-native**. Similar artists arrive already carrying MusicBrainz identifiers, so the similarity step needs no name-based fuzzy join at all — deterministic matching reduces to an MBID equality check, which is strictly more reliable than the alias-and-punctuation matching Last.fm would have required.
3. Published rate-limit headers make pacing observable rather than guessed.
4. No written-approval dependency for attribution placement, and no termination-and-delete clause hanging over the product.

The accepted cost is real: ListenBrainz has no direct equivalent of Last.fm's `tag.getTopArtists` / `tag.getTopTracks`, so the Phase 7 mood workflow will be narrower than Phase 0 assumed. That scope reduction is deferred to Phase 7 and must not be papered over with fabricated candidates.

## Known weakness: the Labs dataset hoster

Similar artists are **not** part of the core ListenBrainz API. The dataset hoster documents itself as a place to "use the web interface for each endpoint" to discover parameters, and the `algorithm` parameter is an opaque tuning string such as `session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30`.

This is a weaker stability guarantee than the core API and weaker than Last.fm's documented `artist.getSimilar`. It was not visible when the provider comparison was written in Phase 0, and it partially offsets reason 4 above.

Mitigations, all inside the adapter:

- The algorithm string is environment-configurable (`LISTENBRAINZ_SIMILARITY_ALGORITHM`), so a change upstream is a configuration edit rather than a code change.
- The response is Zod-validated; an unexpected shape degrades to "no similarity data available" rather than propagating malformed evidence.
- The Labs host is treated as independently unavailable from the core API, so a Labs outage leaves canonical identity and discography working.
- Everything sits behind the neutral `DiscoveryProvider` port, so replacing the source touches one adapter.

## Consequences

- `LASTFM_API_KEY` stays documented in `.env.example` but is unused, mirroring how ADR 0002 treats the Spotify client secret. A compliance test asserts no module reads it.
- `LISTENBRAINZ_USER_TOKEN` remains optional; the adapter works unauthenticated and sends the token only when present.
- Attribution requirements are lighter than Last.fm's, but ListenBrainz and MusicBrainz still require visible source attribution on displayed evidence.
- Phase 7's mood workflow needs redesign against ListenBrainz's actual surface before it is planned. This is a known open item, not a silent gap.

## Alternatives not chosen

**Last.fm with evidence never sent to AI.** Would have kept the stronger tag surface while sidestepping sub-licensing. Rejected because the similarity relationship *is* the licensed data, so withholding it from AI guts `explainArtistMatch` to the point where the AI explanation feature loses its evidence base — while still carrying the commercial-use, attribution-approval and termination clauses.

**Last.fm including AI processing.** Rejected: it requires accepting an ambiguous reading of the sub-licensing prohibition as the foundation for Phases 5 through 7. Written confirmation from `partners@last.fm` would remove the ambiguity, but that is an unbounded external dependency and Phase 4 cannot wait on it.
