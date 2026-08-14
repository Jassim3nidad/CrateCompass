# Spotify integration

Spotify is a **connected account and a destination**, never a source of
recommendations. Everything below follows from that.

---

## What Spotify is allowed to do

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/v1/me` | GET | Read the account identity once, at connect time |
| `/v1/search` | GET | Resolve a candidate the listener has **already** been shown |
| `/v1/me/playlists` | POST | Create a playlist the listener has **already** approved |
| `/v1/playlists/{id}/items` | POST | Add resolved URIs |

Plus `accounts.spotify.com/authorize` and `/api/token` for OAuth. That is the
complete set, enumerated from `lib/providers/spotify/client.ts`.

**Not used, and asserted absent by a compliance test:** `/v1/recommendations`,
`/v1/artists/{id}/related-artists`, `/v1/audio-features`, `/v1/audio-analysis`,
featured playlists, category playlists, and the deprecated
`/v1/playlists/{id}/tracks` form.

Spotify never influences *which* music is recommended — not even which track
represents an artist. That is a compliance position recorded in
`docs/product/phase-7-scope.md`, not a technical preference.

## Scopes

```
playlist-modify-private
playlist-modify-public
```

No read scopes. The application therefore **cannot** access listening history,
top artists, saved items, or playback state even if a future code path tried.

A connection granting less than the required set is refused at the callback and
surfaced as `insufficient-scope` rather than recorded in a broken state.

---

## OAuth flow

Authorization Code with **PKCE** (ADR 0002). No client secret is read anywhere;
a compliance test asserts no module even names that variable.

1. A signed-in listener starts authorization. The server generates a 64-byte
   verifier (86 base64url characters, inside RFC 7636's 43–128), derives an
   `S256` challenge, and creates a state value.
2. **Only the SHA-256 digest of the state is stored**, so someone reading the
   database cannot mint a state that would pass the callback check. The PKCE
   verifier is stored encrypted, bound to the transaction.
3. The callback claims the transaction **atomically and single-use**. A
   replayed, tampered, expired or unknown state all return nothing and are
   indistinguishable from each other.
4. The transaction is bound to the user who started it; a callback delivered
   into a different session is refused as `session-mismatch`.
5. Scopes are checked before anything is recorded.
6. Tokens are sealed and stored; the refresh token is required, and a grant
   without one is rejected rather than saved unusable.

### Token storage

AES-256-GCM. The additional authenticated data binds every ciphertext to
`purpose | subjectId | userId | keyVersion`, so a ciphertext moved between
users, columns or transactions fails authentication instead of decrypting into a
usable secret.

Refresh happens server-side only. Tokens are never logged: the OAuth failure
path records a reason code, never the response body, which can echo the
authorization code, the verifier and the refresh token.

### Failure handling

401, 403, 429 and `QUOTA_EXCEEDED` map to distinct outcomes surfaced to the
listener. `Retry-After` is respected; retries are bounded with exponential
backoff; every request has a timeout.

---

## Setup

### Development

1. Create an app at https://developer.spotify.com/dashboard.
2. Add redirect URI `http://127.0.0.1:3000/api/integrations/spotify/callback`.
   **`127.0.0.1`, not `localhost`** — Spotify requires the explicit loopback IP,
   and the environment schema rejects `localhost` to keep the two aligned.
3. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI`, and generate
   `SPOTIFY_TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`.
4. In Development Mode, add each tester to the app's user allowlist. A listener
   who is not on it gets `not-allowlisted`, which the interface renders as an
   explanation rather than a generic error.

### Production

Add `https://cratecompass.vercel.app/api/integrations/spotify/callback` to the
same app, or to a separate production app.

> **This is currently outstanding.** The production redirect URI has not been
> registered, so on the live deployment the connection surface renders but the
> OAuth round trip, playlist creation and disconnect are **unverified**. Until
> it is registered, an attempted connection will fail at Spotify with
> `INVALID_CLIENT`.

---

## Data retention

The only Spotify-derived values persisted, exhaustively:

| Column | Table | Why |
| --- | --- | --- |
| `spotify_user_id` | `spotify_connections` | Stable account link; detects an account already linked elsewhere |
| `spotify_playlist_id`, `spotify_playlist_url` | `generated_playlists` | The playlist this product created |
| `spotify_uri` | `generated_playlist_tracks` | Target of an idempotent add-items call |

No artist names, album titles, track titles, popularity, audio features or
images from Spotify are stored. **No catalogue mirroring.** This is the
"operationally required" exception recorded in Phase 7 and nothing wider.

## Artwork

The application renders **no images at all** — no `<img>`, no `next/image`, no
`i.scdn.co` reference anywhere. Nothing is downloaded, rehosted, cropped,
altered, watermarked, or overlaid.

If cover art is ever added: hot-link from Spotify's CDN, never rehost, never
modify, never place text over it, and refresh rather than cache indefinitely.

## Attribution and branding

Non-Spotify sources are credited adjacent to the claims they support
("Source: ListenBrainz, MusicBrainz"). Spotify-supplied values — currently only
a resolved artist name — appear with the word "Spotify" in the control, but
**without a Spotify logo or a formal attribution element**.

Whether that satisfies the current Spotify Design Guidelines is a judgement for
the account owner. Flagged as SPC-02 and open.

## Disconnect and deletion

Disconnecting removes stored credentials. Deleting the account cascades every
Spotify-derived row; a pgTAP assertion requires the data export to return
nothing afterwards.

Playlists already created in the listener's Spotify account are **not** deleted —
they belong to the listener, and this product records that it made them rather
than managing them.
