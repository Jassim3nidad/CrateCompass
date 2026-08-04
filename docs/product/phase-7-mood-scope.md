# Phase 7 mood discovery — revised scope

Status: Proposed, awaiting review before implementation  
Date: 2026-08-04  
Supersedes: the Phase 0 mood workflow, which assumed Last.fm  
Related: [ADR 0003](../architecture/adr/0003-discovery-provider-selection.md)

## Why this note exists

Phase 0 designed mood discovery around Last.fm's `tag.getTopArtists` and
`tag.getTopTracks`. ADR 0003 moved the project to ListenBrainz, and those two
methods have no ListenBrainz equivalent. Rather than fake the old behaviour,
this note records what the replacement providers actually return — measured,
not assumed — and proposes a narrower workflow built only on that.

Every figure below comes from live responses captured on 2026-08-04
(`tests/fixtures/provider-evidence.json`) plus a follow-up tag-search probe.

## What is actually available

### 1. MusicBrainz genre and tag data per artist — good

Confirmed on six live artist lookups with `inc=genres+tags`:

| Artist case | Genres | Tags | Release groups carrying genres |
| --- | --- | --- | --- |
| Portishead | 6 | 8 | 20 / 25 |
| Nirvana | 11 | 17 | 23 / 25 |
| Björk | 31 | 47 | 24 / 25 |
| AC/DC | 4 | 4 | 21 / 25 |
| !!! | 3 | 6 | 22 / 25 |
| Sunn O))) | 5 | 10 | 25 / 25 |

Two properties matter:

- **Genres carry vote counts** — `grunge:64`, `trip hop:14`, `hard rock:49`.
  That is a weightable confidence signal, not a flat list.
- **Release-group coverage is high** (20–25 of 25 in every case), so genre data
  exists at album granularity, not only artist granularity.

Tags are a noisier folksonomy than genres. Real examples include `1990s`,
`estados unidos`, `warp`, `sillyname`, and `rock and indie` — decades,
countries, labels, and jokes mixed in with descriptors. A few are genuinely
mood-adjacent (`darkness`, `nothingness`, `low frequency` on Sunn O))) ).

**Only 22 of 43 search results carried inline tags**, so tag data cannot be
assumed present from a search response alone; it requires a lookup.

### 2. MusicBrainz reverse tag search — exists, but ranks badly

The Phase 4 report and the original brief both assumed free tag search was
impossible after dropping Last.fm. **That was wrong.** MusicBrainz search
accepts Lucene syntax against the tag index:

| Probe | Matches | Top 3 returned |
| --- | --- | --- |
| `tag:"trip hop"` | 675 | Fatboy Slim, Moby, **Madonna** |
| `tag:"ambient"` | 5385 | **Various Artists**, **[unknown]**, sonnov |
| `tag:"drone metal" AND country:US` | 19 | Melvins, Sunn O))), Naked City |
| `tag:"trip hop"` (release-group) | 10812 | OnlySee, Shoulder Holster, Mezzanine B-Sides |

The capability is real and boolean filters work. The **ranking is the problem**:
results are ordered by Lucene text relevance, not by popularity, quality, or
tag-vote weight. Broad tags surface placeholder entities (`Various Artists`,
`[unknown]`) and obscure B-sides above the artists a listener means. Narrow,
specific tags combined with a filter behave well.

Using these results raw would produce visibly poor recommendations.

### 3. ListenBrainz similarity — strong, but needs a seed

Labs `similar-artists` returned 100 rows for every real MBID tried, with
unnormalised integer scores (observed range 1534–11156). It is genuinely useful
ranking data, and it is MBID-native.

Its constraint is structural: **it takes one seed artist, not a tag or a set.**
It cannot answer "artists that sound like a rainy Sunday"; it can only answer
"artists similar to this specific artist".

## Proposed Phase 7 scope

### The workflow

1. **User writes a mood** in free text. This is user-authored, so it may enter
   the AI provider.
2. **AI parses it into application-owned criteria** — the existing `MoodCriteria`
   schema, including `genreHints`. No provider data is involved.
3. **Seed selection.** `genreHints` become a MusicBrainz tag query, narrowed with
   type and country filters where the criteria supply them. Results are filtered
   through a placeholder blocklist (`Various Artists`, `[unknown]`, and similar)
   and re-ranked by the artist's own genre vote counts for the matching tag,
   rather than trusting Lucene order.
4. **The user confirms the seed.** They see the candidate seeds and pick one.
   This is the step that converts a badly-ranked list into a good one — a person
   recognises "Madonna is not what I meant by trip hop" instantly.
5. **Expansion via ListenBrainz** similarity from the confirmed seed, which is
   where the reliable ranking comes from.
6. **Resolution and review** through the existing deterministic Spotify matcher,
   unchanged.

### What this deliberately does not do

- **No unsupervised tag-to-playlist generation.** Step 4 is a required human
  checkpoint, not an optimisation. Without it the output quality is governed by
  Lucene relevance, which the probe shows is poor.
- **No `findArtistsByTags` / `findTracksByTags` on the discovery provider.**
  Tag search is a *MusicBrainz* capability, not a ListenBrainz one. Putting it
  behind the discovery port would misrepresent where it comes from. Both methods
  now throw `UnsupportedDiscoveryOperationError` so a caller fails immediately
  and clearly instead of receiving an empty list that resembles zero matches.
- **No mood-to-track discovery.** Release-group tag search ranked worst of all
  the probes. Track-level mood selection is deferred until there is a ranking
  signal worth trusting.
- **No fabricated tag vocabulary.** Mood terms map only to tags that exist in
  MusicBrainz. A mood with no tag match returns an honest empty state.

### Cost relative to Phase 0

The original design promised mood in, playlist out, with no intermediate step.
This design requires the user to confirm a seed artist. That is a real
reduction in convenience and should be presented as a feature of the product's
transparency, not hidden.

## Open questions for review

1. Is the seed-confirmation step acceptable, or should mood discovery be cut
   from the MVP entirely rather than shipped in this narrower form?
2. Should the placeholder blocklist be a maintained list, or should selection be
   restricted to artists above a minimum genre vote count?
3. Track-level mood discovery is deferred. Does Phase 7 still deliver enough
   product value without it?
