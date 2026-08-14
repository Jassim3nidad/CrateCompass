# Discovery provider

The discovery provider answers one question: **which artists are related to this
one, and how strongly?** It is the only source of similarity in the product.

Port: `lib/providers/discovery/port.ts`. Implementation:
`listenbrainz.ts`. Selection: `index.ts`, the single seam.

---

## Why ListenBrainz and not Last.fm

ADR 0003. The deciding factor was licensing, not features.

Last.fm's terms prohibit sub-licensing its data to a third party. Sending
Last.fm-derived evidence to OpenAI or Anthropic is at best legally ambiguous,
and the product's core feature is explaining evidence with a model. ListenBrainz
listen data is CC0, which makes the same operation unambiguous.

`DISCOVERY_PROVIDER=lastfm` is accepted by the environment schema but **has no
adapter**. Selecting it boots, then fails at the first discovery call with a
`not-configured` error, and the settings page reports the provider as
unavailable rather than pretending otherwise. A compliance test asserts no
module reads a Last.fm key.

## Responsibilities

- Similar artists for a seed MBID, with a similarity score
- Artist tags for genre-adjacent discovery
- Mood-related candidates, after seeds are confirmed by the listener
- The evidence a relationship claim rests on

## Configuration

```
DISCOVERY_PROVIDER=listenbrainz
LISTENBRAINZ_USER_TOKEN=            # optional; not needed by the endpoints used
LISTENBRAINZ_SIMILARITY_ALGORITHM=  # optional override
```

No account required.

---

## Operational reality

**Similar artists come from `labs.api.listenbrainz.org`** — a research surface
with no stability guarantee. Treat every response as untrusted:

| Behaviour | Handling |
| --- | --- |
| Errors return **HTML, not JSON** | Parsing is defensive; a non-JSON body becomes a provider error, not a crash |
| An unknown MBID returns `200 []` | An empty result is "nothing reported", never an error |
| The endpoint can disappear | Discovery degrades to a stated provider-unavailable state; nothing is fabricated |

**The popularity API is server-side disabled.** Probing
`/1/popularity/top-recordings-for-artist/` returned
`500 — "Popularity API currently disabled due to high load"`, confirmed twice.

This is why playlist tracks are the opening tracks of an artist's studio
releases rather than their best-known ones. The interface says which album each
track came from rather than implying a ranking it does not have. Track selection
sits behind a port (`lib/mood/track-selection.ts`), so adding popularity later
is an adapter plus a ranking step, not a redesign.

Spotify's own ordering is excluded as a ranking source. That is a compliance
position, not a technical preference.

---

## How similarity becomes a recommendation

The provider returns a raw score. The product does three things before showing
anything:

1. **Reconcile to MusicBrainz.** A similar artist is only shown once it resolves
   to a canonical identity, so the listener gets a real artist page rather than
   a dangling name.
2. **Normalise to the result set.** Scores are expressed relative to the
   strongest match in *this* set, which is honest about the fact that a raw
   similarity number means little in isolation.
3. **Keep the provider's rank.** Rank is never renumbered after a dismissal;
   doing so would quietly rewrite what ListenBrainz reported.

The strength badge is derived deterministically from the relative score. No
model decides how strong a relationship is — a model only explains a
relationship that a provider already reported.

## Attribution

Rendered beside the results, linked, alongside MusicBrainz. ListenBrainz data is
on the AI-approved provenance allowlist under ADR 0003.

## Failure behaviour

Timeouts on every request, bounded retries with backoff, and a stated
provider-unavailable state in the interface. Partial results are shown as
partial and labelled — a truncated result set and a failed retrieval are
different facts and get different sentences.

Nothing is ever invented to fill a gap.
