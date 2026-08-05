# Phase 6 — Similar-artist discovery

Status: implemented  
Last reviewed: 2026-08-05

## What the feature does

A listener searches for an artist, picks the canonical MusicBrainz record they
meant, and receives artists ListenBrainz relates to it. Each result can be
expanded to show the evidence behind the relationship and a written reading of
that evidence, saved to their library, dismissed, or opened in Spotify.

## Division of responsibility

| Step | Owner | Notes |
| --- | --- | --- |
| Artist search and canonical identity | MusicBrainz | Selection is always explicit; a single result is not auto-selected |
| Related artists and similarity score | ListenBrainz | The only source of "who is related to whom" |
| Shared tags, artist type, country, releases | MusicBrainz | Fetched per candidate, on demand |
| Match evidence | Application (`lib/discovery/evidence.ts`) | Pure and deterministic |
| Written explanation | AI provider | Optional; verified after the fact and discarded if unsupported |
| Opening a result | Spotify | Resolution only, on request, never persisted |

## The AI boundary in this feature

`lib/discovery/**` and `features/discovery/**` cannot import a Spotify provider
module — enforced by an ESLint rule and by a repository scan in
`tests/compliance/spotify-boundary.test.ts`. Spotify resolution lives in
`features/spotify/actions.ts`, which cannot import an AI module. No single file
can carry data from one side to the other.

What the AI provider receives for an explanation:

- the seed and candidate artist names;
- the listener's own words, if they typed any;
- the evidence statements, each tagged `musicbrainz` or `listenbrainz`;
- up to twelve MusicBrainz release groups, as identifier, title, type, year.

Everything is parsed through `buildAiInput`, whose schema is `.strict()`, so an
unknown field is a rejection rather than a silent strip.

## Evidence rules

- Similarity strength is expressed **relative to the strongest candidate in the
  same result set**, never as an absolute measure. ListenBrainz scores are
  unnormalised and their scale varies by seed artist.
- Provider rank is the position ListenBrainz gave the candidate. It is not
  renumbered when a listener dismisses something above it.
- A starting point is the candidate's earliest dated studio album from
  MusicBrainz. Live albums, compilations, and undated releases are not
  substituted; when there is no qualifying release there is no starting point.
- Absent tags are reported as absent data, never as evidence of absence.

## Explanation verification

An AI explanation is used only if all three hold:

1. every entry in `groundedIn` is supported by a supplied evidence statement
   (token containment ≥ 0.5, `lib/discovery/explanation.ts`);
2. any `startingPointReleaseId` is one of the release groups supplied;
3. the output does not mention Spotify — impossible from our inputs, so its
   presence means the model drew on its own priors.

Otherwise the deterministic template is used, and the interface says which of
the two the listener is reading and why. The template restates what the
providers reported and explicitly declines to describe how the music sounds.

## When AI is not called at all

- **Anonymous listeners.** Usage is metered per account; there is no meter to
  charge. They get the template, labelled as such.
- **Usage limit reached.** Reported plainly rather than hidden behind a silent
  fallback.
- **Provider unavailable, refusing, or returning invalid output.** Template.

## States

| State | Where it comes from |
| --- | --- |
| Empty | ListenBrainz reports no similar artists |
| Empty (all dismissed) | Every reported candidate has been dismissed |
| Partial | Relationship known, candidate MusicBrainz lookup failed |
| Provider unavailable | ListenBrainz call failed — the artist header still renders |
| Rate limited | Distinguished from an outage in the copy |
| Auth required | Save and dismiss, signed out |
| Ambiguous / unresolved | Spotify resolution could not decide, or found nothing |

## Why candidate metadata is fetched on demand

MusicBrainz is paced at one request per second. Enriching a page of twelve
candidates before the first render would block it for twelve seconds, so the
list renders from similarity data alone and a candidate's MusicBrainz record is
fetched when its explanation is opened.

## Provider disclosure

The explanation panel accepts free text from the listener, so what the
configured provider does with that text has to be stated where they type it,
not only in a policy page. `lib/ai/disclosure.ts` returns the notice for the
configured provider — Google's free Gemini tier states that submitted content
is used to improve their products (ADR 0005), and OpenRouter introduces at
least two additional processors (ADR 0004). The notice is computed server-side
because `AI_PROVIDER` is not public configuration.

## Test fixtures

Provider calls are server-side, so Playwright cannot intercept them. The
end-to-end suite runs against invented MusicBrainz and ListenBrainz data in
`lib/providers/fixtures/`, selected by the two provider factories when
`APP_ENV=test` **and** `PROVIDER_FIXTURES=1`. The environment schema refuses to
validate that flag outside a test environment, so a deployment carrying it
fails to start rather than serving invented artists as provider records.

## Live verification

Two suites exist that the ordinary `npm test` run skips, because they touch
real services and must never be a prerequisite for a green build:

```bash
LIVE_PROVIDERS=1 npx vitest run tests/live/providers-live.test.ts
LIVE_DATABASE=1 npx vitest run tests/live/discovery-database.test.ts
```

The first proves the provider factories return the real adapters when fixtures
are off, and runs one real explanation end to end through MusicBrainz,
ListenBrainz and the configured AI provider. The second exercises the discovery
repository against a local database with two signed-in listeners, proving Row
Level Security stops each from reading or deleting the other's decisions.

Spotify is absent from both: reaching it needs a connected account, and
automated tests may not use one.

## Deferred

- **Discovery history rows.** No session or result records are written yet.
  There is no history UI, retention rule, or deletion control until Phase 9, and
  accumulating records a listener can neither see nor clear is the wrong order
  to build a privacy-relevant feature in.
- **Saved explanations and notes.** Phase 9.
- **Discography browsing and questions.** Phase 8.
