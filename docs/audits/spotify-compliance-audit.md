# CrateCompass Spotify compliance audit

Phase: 11 · Date: 2026-08-10 · Commit audited: `4619141`
Scope: the Spotify Developer Terms surface reachable from this codebase.
Not a legal opinion. Two items below need review by whoever owns the developer
account, and are marked as such.

---

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 1 |
| Informational | 2 |

The defining constraint — **no Spotify content reaches an AI provider** — holds,
and is enforced by four independent mechanisms that were each verified. The High
finding is a missing user-facing privacy policy, which is a prerequisite for a
Spotify application rather than a defect in the integration.

---

## The AI boundary — verified, four independent enforcements

This is the product's central compliance commitment. Each layer was checked
separately, because the value of the design is that no single failure defeats it.

**1. Type level.** Spotify values carry branded types (`SpotifyResourceId`,
`SpotifyUri`). AI input types are built from plain strings and cannot accept
them. Non-assignability is asserted at compile time by the contract suite.

**2. Runtime gateway.** Every AI call passes `buildAiInput`
(`lib/ai/gateway.ts`), which applies, in order: a strict Zod parse that rejects
unknown keys; a provenance allowlist on which Spotify never appears; a recursive
scan for forbidden keys, `spotify:*:` URIs, Spotify-controlled hosts
(`spotify.com`, `scdn.co`, `spotifycdn.com`) and credential-shaped strings at
any depth; and caps of 12 levels and 60,000 serialised characters. It returns
the *parsed clone*, so the payload on the wire cannot be the caller's original
object with extra properties attached.

**3. Module graph.** ESLint `no-restricted-imports` keeps the trees disjoint:
`lib/ai/**` cannot import Spotify provider modules; `lib/discovery/**`,
`features/discovery/**`, `lib/mood/**`, `features/mood/**`,
`lib/discography/**`, `features/discography/**` cannot either; and
`lib/providers/spotify/**`, `features/playlists/**`, `lib/library/**`,
`features/library/**`, `features/history/**` cannot import AI modules.

**4. Repository scan.** `tests/compliance/spotify-boundary.test.ts` reads the
source tree and asserts all of the above, plus log redaction and the fixture
gate. It passes in the current run.

**No Spotify data is used to train, fine-tune, evaluate or profile a model.**
No training, embedding or evaluation pipeline exists in the repository.

---

## SPC-01 · No user-facing privacy policy or terms — **High**

`app/` contains no `privacy`, `terms` or `legal` route. The site footer links
"Privacy" to `/settings`, which is an account settings page, not a policy.

The substance exists internally — `docs/security/data-handling.md` enumerates
categories, retention and the deletion procedure, and
`docs/compliance/spotify-compliance.md` records the provider position — but none
of it is published to a user, and a listener connecting a Spotify account is
therefore consenting without a stated policy.

A privacy policy is a standing requirement for a Spotify application, including
in Development Mode, and it is the artefact a quota-extension review asks for
first. This blocks any pilot involving a user other than the developer.

Needs: a published policy naming the data categories held, the third parties
involved (Supabase, MusicBrainz, ListenBrainz, the configured AI provider,
Spotify), the AI-processing boundary, retention, and the deletion route; a terms
page; and footer links pointing at them rather than at `/settings`.

---

## SPC-02 · Spotify attribution is textual only, not to the design guidelines — **Medium** *(needs owner review)*

Where Spotify supplies a displayed value — the resolved artist name in
`features/discovery/components/spotify-link.tsx:49`, rendered as
"Open {name} in Spotify" — the word "Spotify" appears, but there is no Spotify
logo and no attribution element following the Spotify Design Guidelines.

By contrast the non-Spotify sources are credited properly and adjacently:
`ProviderAttribution` renders "Source: ListenBrainz, MusicBrainz" next to the
claims it supports.

Spotify's guidelines are specific about logo use, minimum sizes, and the
requirement to attribute content as coming from Spotify. Whether the current
textual treatment satisfies them is a judgement for the account owner against
the current published guidelines, which is why this is flagged rather than
asserted as a violation. It should be resolved before the pilot, since branding
review is part of any quota extension.

---

## SPC-03 · Connected-account data flows are correct but undocumented to the user — **Medium**

The integration behaves correctly: minimum scopes, explicit connect, working
disconnect, cascade on delete. What is missing is the user-facing statement of
what connecting does — which is the other half of SPC-01 and is listed
separately because it is a copy task on `/settings/connections` rather than a
new legal page.

`/settings/connections` states the scopes requested and that no Spotify data
reaches an AI provider (verified by end-to-end test). It does not state what is
*stored* as a result of connecting: the Spotify account id, the display name,
the granted scopes, and encrypted tokens.

---

## SPC-04 · No Spotify artwork is displayed at all — **Low** *(observation, not a violation)*

The repository renders no images whatsoever — no `<img>`, no `next/image`, no
`i.scdn.co` reference anywhere in `app`, `components`, `features` or `lib`.

Every artwork rule is therefore satisfied vacuously: nothing is downloaded,
rehosted, cropped, altered, watermarked, or overlaid with text. Recorded because
the compliance position "artwork is unmodified" currently rests on there being
no artwork, and that changes the moment a cover grid is added. The rules should
be restated as an implementation constraint before that happens, not after.

---

## SPC-05 · `spotify_uri` retention on generated playlists — **Informational**

Persisted Spotify-derived columns, exhaustively:

| Column | Table | Justification |
| --- | --- | --- |
| `spotify_user_id` | `spotify_connections` | Stable account link; required to detect an account already linked to another user |
| `spotify_playlist_id`, `spotify_playlist_url` | `generated_playlists` | The playlist this product created for the listener |
| `spotify_uri` | `generated_playlist_tracks` | Resolved target of an idempotent add-items call |

No artist names, album titles, track titles, popularity, audio features or
images obtained from Spotify are persisted. This is the "operationally required"
exception recorded in Phase 7, and it is the minimum that makes idempotent
playlist creation and repair possible. **No catalogue mirroring** is present.

Worth a decision at pilot review, not now: `spotify_uri` rows remain after the
playlist exists, and are only strictly needed during creation and repair. A
retention window on `generated_playlist_tracks` would shrink the Spotify-derived
footprint further.

---

## SPC-06 · Development Mode allowlist is an untested assumption — **Informational**

The pilot design assumes a Spotify application in Development Mode with a
25-user allowlist, of which five are planned. Nothing in the repository verifies
that the configured client is in Development Mode or that a given account is on
the allowlist; the code handles `not-allowlisted` as a callback outcome and
renders it as an alert, which is the correct runtime behaviour.

Flagged so it is checked against the actual dashboard before the pilot, rather
than inherited from a Phase 0 planning assumption.

---

## Endpoint and scope review — verified

**Every Spotify endpoint the application can call**, enumerated from
`lib/providers/spotify/client.ts`:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/v1/me` | GET | Account identity at connect time |
| `/v1/search` | GET | Resolve an already-chosen candidate |
| `/v1/me/playlists` | POST | Create a playlist after explicit approval |
| `/v1/playlists/{id}/items` | POST | Add resolved URIs |

Plus `accounts.spotify.com/authorize` and `/api/token` for OAuth. That is the
complete set.

**No deprecated endpoint is referenced anywhere in the repository.** Scanned for
and found absent: `/v1/recommendations`, `/v1/artists/{id}/related-artists`,
`/v1/audio-features`, `/v1/audio-analysis`, featured-playlists and category
playlists. The playlist-items path uses the current `/items` form; a compliance
test asserts the deprecated `/tracks` form appears nowhere.

**Scopes** are exactly `playlist-modify-private` and `playlist-modify-public`
(`lib/providers/spotify/config.ts:24`). No read scopes are requested, so the
application cannot access listening history, top artists, saved items or
playback state even if a future code path tried. A connection granting less than
the required set is refused at callback rather than recorded in a broken state.

**Spotify does not influence what is recommended.** Discovery comes from
ListenBrainz, identity and discography from MusicBrainz. Spotify is reached only
to resolve a candidate the listener has already been shown, and to create a
playlist they have already approved. Track selection deliberately does not use
Spotify ordering — recorded as a compliance position, not a technical
preference, in `docs/product/phase-7-scope.md`.

**Rate limiting and failure handling.** Bounded retries with exponential
backoff, `Retry-After` respected, and 401 / 403 / 429 / `QUOTA_EXCEEDED` mapped
to distinct outcomes surfaced to the listener. Timeouts on every request.

**Disconnect and deletion.** Disconnect removes stored credentials; account
deletion cascades every Spotify-derived row, verified by the pgTAP residual-data
assertion (T23).

---

## Verdict

The integration itself is compliant on every technical point examined: correct
endpoints, minimum scopes, no catalogue mirroring, no artwork handling, no
Spotify data reaching a model, working disconnect and deletion.

What is missing is the published-documents layer — SPC-01 and SPC-03 — plus a
branding judgement, SPC-02. None requires re-engineering; all three block a
pilot with real users.
