# ADR 0002 — Spotify OAuth flow selection

Status: Accepted 2026-08-04  
Date: 2026-08-04  
Phase: 3 precondition  
Related: [ADR 0001](0001-spotify-token-encryption.md)

## Context

`docs/compliance/spotify-compliance.md` and the implementation roadmap both name "Authorization Code with PKCE". The Phase 3 brief permits either "Authorization Code with PKCE **or** secure server-side Authorization Code flow", and separately requires that the client secret never reach browser code.

The 2026-08-04 documentation re-review established that on Spotify these are **two distinct flows with mutually exclusive client authentication**, not one flow with an optional hardening step:

| | Authorization Code with PKCE | Authorization Code (confidential) |
| --- | --- | --- |
| `/api/token` exchange | `client_id` + `code_verifier` in body | HTTP Basic `client_id:client_secret` |
| Refresh request | `client_id` in body | HTTP Basic `client_id:client_secret` |
| Client secret | Not used at all | Required |

Spotify's PKCE tutorial documents no `client_secret` parameter and no Basic authentication on the token request. Sending `code_verifier` *and* Basic auth together is not documented. For a compliance-sensitive integration this project will not depend on undocumented behaviour, so the two flows are a genuine either/or.

CrateCompass performs the exchange and every refresh server-side in both cases, so "keeping the secret off the browser" is satisfied either way. The choice is therefore not about where the secret lives — it is about which leg of the flow gets cryptographic protection.

## Threat comparison

**PKCE protects the authorization-code leg.** A stolen authorization code is useless without the `code_verifier`, which is generated server-side, stored as AEAD ciphertext in `private.spotify_oauth_transactions`, and consumed exactly once.

**The confidential flow protects the refresh leg.** A stolen *plaintext* refresh token cannot be redeemed without the client secret. Under PKCE the client ID is public — it appears in every authorization URL — so a plaintext refresh token is sufficient on its own.

That asymmetry matters here because refresh tokens live six months (ADR 0001), while an authorization code lives seconds and is additionally protected by exact redirect-URI matching plus one-time, user-bound, ten-minute state.

Against that: the client secret is a single static credential shared across every user, valid until manually rotated, and present in every environment that runs the app. Its realistic failure mode is disclosure — as this project has already demonstrated once during setup. The refresh-token plaintext, by contrast, exists only transiently in server memory; at rest it is AES-256-GCM ciphertext, AAD-bound to its row, in a schema PostgREST does not expose and only `service_role` can reach.

Redeeming a stolen refresh token under PKCE therefore requires an attacker who has already achieved server memory access or has both the database ciphertext and the encryption key. In those scenarios the client secret would very likely be readable too, since it sits in the same environment. The secret's marginal protection is real but narrow.

## Decision

**Use Authorization Code with PKCE (S256). The client secret is not used.**

- `code_verifier`: 64 bytes from `crypto.randomBytes`, base64url, per transaction.
- `code_challenge`: `base64url(SHA-256(code_verifier))`, `code_challenge_method=S256`.
- The verifier is encrypted under ADR 0001 with purpose `spotify.code_verifier`, AAD-bound to the transaction and user, and destroyed on consumption.
- `state`: 32 bytes from `crypto.randomBytes`; only its SHA-256 digest is stored, in `state_digest`; bound to `user_id`; ten-minute expiry; consumed atomically exactly once.
- Refresh sends `grant_type=refresh_token` + `refresh_token` + `client_id` in the body.

Rationale, in order of weight:

1. It is what Spotify documents precisely for this shape of application, so no behaviour is assumed.
2. It matches what the compliance plan and roadmap already committed to, so no compliance document has to be weakened.
3. It removes a long-lived static credential from the system entirely. `SPOTIFY_CLIENT_SECRET` becomes unused, which converts a standing disclosure risk into a non-issue and eliminates a rotation obligation.
4. The per-transaction verifier is at least as strong as a static secret on the leg it protects, and it is not shared between users.

The accepted trade is the narrower refresh-leg protection described above, mitigated by ADR 0001's at-rest controls and by the disconnect path, which destroys ciphertext before anything else so a revoked connection cannot be refreshed even if a race is attempted.

## Consequences

- `SPOTIFY_CLIENT_SECRET` is **not read by application code**. It stays documented in `.env.example` because switching to the confidential flow would need it, but `lib/validation/environment.ts` does not require it and no module imports it.
- The secret already disclosed during setup can be rotated at leisure or left alone; nothing depends on it.
- If this decision is later reversed, the change is contained: the token-exchange and refresh request builders in `lib/providers/spotify/oauth.ts`, plus the environment requirement. Neither the client, the token manager, nor the UI is affected.
- Automated tests assert that no Spotify module reads `SPOTIFY_CLIENT_SECRET`, so an accidental reintroduction fails the suite rather than silently creating a second authentication path.

## Alternative not chosen

**Authorization Code (confidential, Basic auth).** Defensible, and the stronger option specifically against theft of a plaintext refresh token by an attacker who cannot read the application environment. Rejected because that attacker profile is narrow, because it requires weakening the PKCE commitment already recorded in the compliance plan, and because it makes a shared static secret permanently load-bearing. If this is preferred, say so before implementation begins — it is a small change now and a larger one after the token manager exists.
