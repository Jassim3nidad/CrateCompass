# MusicBrainz integration

MusicBrainz supplies **identity and facts**: who an artist canonically is, what
they released, and when. It is the only source permitted to answer a factual
question about a discography.

Module: `lib/providers/musicbrainz/`. Product code calls
`getMusicBrainzClient()` and never imports the client directly, so fixtures have
exactly one seam.

---

## Responsibilities

- Canonical artist identity (MBID) and aliases
- Release groups: albums, EPs, singles, live records, compilations
- Release dates with **precision** (year, year-month, full date)
- Artist tags, used as discovery evidence
- The retrieved context behind every discography answer

MBIDs are the application's primary key for music. Nothing is keyed on an
artist name, because names are ambiguous and Spotify identifiers are not ours to
depend on.

## Requirements

MusicBrainz requires a User-Agent naming a real contact, and throttles or blocks
traffic without one. All three variables are mandatory in the environment
schema:

```
MUSICBRAINZ_APP_NAME
MUSICBRAINZ_APP_VERSION
MUSICBRAINZ_CONTACT
```

No API key exists. No account is needed.

## Rate limiting

**One request per second, globally**, enforced by a process-wide pacer
(`lib/providers/musicbrainz/pacer.ts`) rather than per-call.

This is the dominant cost in the product. Building a twelve-artist playlist is
24–36 requests, which is why the mood workflow states *why* it is slow rather
than showing a silent spinner. Tests that exercise paging mock the pacer.

Every request has a timeout and bounded retries; 503s are retried with backoff.

---

## Things learned against the live service

These were measured. Re-probing costs time; trust them unless behaviour changes.

### `inc=release-groups` silently caps at 25

The lookup returns at most 25 release groups **with no indication** that more
exist. Portishead has exactly 25, which is why this hid for two phases.
Nirvana has 573.

A result of exactly 25 now escalates to paginated `browseReleaseGroups`. A
safety bound of 10 pages exists because the "Various Artists" entity holds
**288,991** release groups — roughly 45 minutes at one request per second.

When the bound engages, `Discography.retrievalComplete` is `false`, and that
flag is load-bearing: any answer that states a total must check it. A count over
a truncated list is a wrong answer delivered confidently.

### Tag search ranks by Lucene relevance, not quality

`tag:"trip hop"` returns Madonna in the top three. `tag:"ambient"` returns
`[unknown]` first.

Hence placeholder filtering, vote-count re-ranking, and a required human
seed-confirmation step in the mood flow. The application never turns a tag
search directly into a recommendation.

### Date precision is meaningful

`1994`, `1994-08`, and `1994-08-22` are different claims. The domain type keeps
precision (`PartialDate`) and the interface renders what is known rather than
padding to a full date.

---

## Prompt-injection surface

Release titles and disambiguation comments are **community-edited** and travel
to a model as retrieved context. A release group can legitimately be titled
"Ignore previous instructions and…".

`lib/discography/sanitize.ts` handles this in two layers:

- **Neutralisation, which does the work.** Control characters collapse to a
  space, invisible characters (zero-width, bidi overrides, BOM) are removed,
  whitespace is collapsed, fields are capped at 300 characters, and identifiers
  must match a plausible MBID shape or the record is dropped from context.
- **Detection, which only logs.** Instruction-shaped phrases set a boolean and
  never block, because MusicBrainz holds real releases whose titles are
  imperative sentences and a blocking heuristic would corrupt genuine
  discographies silently.

The original text is always returned untouched for display; altering what is
shown would misrepresent MusicBrainz.

> **Known gap:** this is applied on the discography Q&A path. The
> artist-explanation path interpolates provider strings without it. Recorded as
> SEC-05 and open.

## Caching and attribution

Lookups are cached for six hours, so an artist page and its metadata title cost
one retrieval rather than two.

Attribution is rendered beside the data it describes — "Source: MusicBrainz",
linked — rather than once in a page footer, because attribution far from the
claim does not tell a reader where a particular statement came from.

Data is licensed under CC0 (core data) and CC BY-NC-SA (supplementary). It is on
the AI-approved provenance allowlist, so MusicBrainz metadata may be sent to a
model. Spotify never appears on that list.
