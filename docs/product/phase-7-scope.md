# Phase 7 — Natural-language mood playlists: scoping

Status: proposed, not started — awaiting decisions on the open questions  
Date: 2026-08-05  
Builds on: [phase-7-mood-scope.md](phase-7-mood-scope.md) (ListenBrainz
constraints), [ADR 0003](../architecture/adr/0003-discovery-provider-selection.md),
[phase-6-discovery.md](phase-6-discovery.md)

## What Phase 7 promises

A listener describes a moment in their own words and gets a playlist in their
Spotify account: mood in, reviewed tracks out, created only on explicit
confirmation.

The gap between that promise and what the approved providers can supply is the
whole design problem, and it is a **track-selection** problem.

## What the providers actually give us

Re-probed live on 2026-08-05, because the answer changed since the Phase 4 note.

| Capability | Source | State |
| --- | --- | --- |
| Mood text → structured criteria | AI (`parseMood`) | Working, schema-validated, shipped in Phase 5 |
| Tag → candidate artists | MusicBrainz Lucene tag search | Works; ranks badly (placeholders and obscure entities outrank the obvious answer) |
| Artist → similar artists | ListenBrainz Labs | Strong, MBID-native, needs a confirmed seed |
| Artist → ranked tracks | ListenBrainz popularity API | **Exists but server-side disabled**: `500 — "Popularity API currently disabled due to high load"`, twice |
| Track → similar tracks | ListenBrainz Labs `similar-recordings` | Works, own algorithm enumeration, needs a seed recording |
| Artist → recordings | MusicBrainz recording search | Works, 946 rows for Portishead, Lucene-ranked; top hit was a 1995 live version |
| Track popularity / audio features | Spotify | **Forbidden as a discovery input** |

The consequence: **there is no working non-Spotify signal for "which tracks by
this artist"** today. Everything else Phase 7 needs is available.

## Boundary interaction

Phase 6 established that no module can hold both a Spotify value and an AI call,
enforced by ESLint and repository scans. Phase 7 keeps that shape:

- `lib/mood/**` and `features/mood/**` join the rule that forbids importing
  Spotify provider modules.
- Playlist creation lives in `features/playlists/**`, which imports Spotify and
  **no** AI module.
- AI receives only: the listener's mood text, their explicit control settings,
  and application-owned taxonomy. Never a resolved track, never a Spotify id.
- Title and description are generated **before** Spotify resolution, from
  approved inputs only — so no Spotify-derived value can reach that call even
  by accident of ordering.

The mood form is a second free-text surface, so it carries the same
provider disclosure Phase 6 added (`lib/ai/disclosure.ts`).

## In scope

1. Mood form, clarification loop when `clarificationNeeded` is set, and a
   readable rendering of the parsed criteria.
2. Deterministic controls the listener sets directly: playlist length, era,
   genre emphasis, instrumental/vocal, explicit-content preference, artists to
   include, artists to avoid. **AI interprets; deterministic code enforces.**
3. Seed confirmation — tag-search candidates, placeholder-filtered and
   re-ranked, chosen by a person before expansion.
4. Expansion through ListenBrainz similarity from the confirmed seed.
5. Track selection (see open question 1).
6. Candidate review: remove, replace, reorder before anything is created.
7. Explicit confirmation, then idempotent Spotify playlist creation with
   batched item addition and accurate partial-failure reporting.
8. An application-owned playlist record.

## Deferred

- **Energy, tempo, and valence as enforced filters.** The only source for these
  is Spotify audio features, which is forbidden as a discovery input. They
  remain soft tag hints and the interface must say so rather than implying a
  filter that does not exist.
- **Language preference as an enforced filter.** MusicBrainz release language
  is partial; treat as a hint.
- **Unsupervised mood-to-playlist.** Seed confirmation stays a required step.
- **Mood-to-track discovery without a seed artist**, unless open question 1
  resolves otherwise.

## Rough module plan

```
lib/mood/
  controls.ts          deterministic control merge + enforcement over AI criteria
  seed-ranking.ts      placeholder blocklist, vote-count re-ranking (pure)
  track-selection.ts   candidate tracks from approved sources (pure)
lib/providers/musicbrainz/
  client.ts            + tag search, + release track listing
features/mood/
  service.ts           parse -> seeds -> expansion -> candidates
  actions.ts           parseMood, confirmSeed, buildCandidates, editCandidates
  components/          mood form, criteria panel, seed picker, candidate list
features/playlists/
  creation.ts          state machine: draft -> creating -> created | partial | failed
  repository.ts        generated_playlists + idempotency records
  actions.ts           createPlaylist (Spotify only, no AI imports)
supabase/migrations/
  ..._phase_7_playlists.sql   playlist track records, creation state
```

Reused unchanged: `parseMood`, `generatePlaylistTitle`,
`generatePlaylistDescription`, the AI gateway, `resolveSpotifyArtist`,
`createPlaylist` / `addPlaylistItems`, and `private.idempotency_records` —
created in Phase 2 and still unused, which is exactly the duplicate-submission
control Phase 7 needs.

## Risks

- **Track quality is the product risk.** Artist selection is well-sourced;
  track selection is not. A playlist of correct artists represented by their
  wrong tracks will read as a broken feature.
- **ListenBrainz Labs remains a single point of failure** with no stability
  guarantee, now on the critical path for both artists and (potentially) tracks.
- **MusicBrainz pacing.** Track listing needs a release lookup per album at one
  request per second. A twelve-artist playlist implies roughly 24–36 paced
  requests; this needs streaming, caching, and a progress state, or it reads as
  a hang.
- **Playlist creation is the first irreversible outward action** in the product.
  Idempotency and honest partial-failure reporting are not polish here.

## Open questions

These block implementation; none should be answered by guessing.

1. **Where do tracks come from?** Three viable answers:
   - *(a) MusicBrainz studio-album tracks.* Strictly sourced, no popularity
     signal — track order within an album is arbitrary, so the playlist is
     "real tracks by the right artists" rather than "their best tracks".
   - *(b) Spotify search ranking picks the track* for an artist we already
     chose by non-Spotify means. Stays inside the endpoint allowlist and never
     reaches AI, but lets Spotify influence content selection, which is a
     stricter reading of the boundary than "resolution only". **This is a
     compliance judgment, not a technical one.**
   - *(c) Defer track playlists;* ship mood → artist shortlist only.
2. **Public playlists.** The connection holds `playlist-modify-private` and the
   client hardcodes `public: false`. Supporting the documented public/private
   control needs an additional scope and re-consent from every connected user.
   Keep private-only, or widen the scope?
3. **Explicit-content control.** Enforcing it needs the `explicit` flag from
   Spotify search results, which today's schema does not parse. Filtering-only
   use never reaches AI. Parse it, or drop the control?
4. **Per-track persistence.** Repairing a partially-added playlist requires
   knowing which URIs were meant to be in it. Store MusicBrainz ids plus
   Spotify URIs per generated playlist, or keep the record artist-level and
   accept that partial failures can be reported but not repaired?
