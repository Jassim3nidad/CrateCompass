# ADR 0001 — Spotify token encryption and key rotation

Status: Accepted 2026-08-04  
Date: 2026-08-04  
Phase: 3 precondition  
Supersedes: none

## Context

Phase 2 created `private.spotify_credentials` with this shape:

| Column | Type |
| --- | --- |
| `connection_id` | `uuid` primary key → `public.spotify_connections(id)` |
| `access_token_ciphertext` | `bytea not null` |
| `access_token_nonce` | `bytea not null` |
| `refresh_token_ciphertext` | `bytea not null` |
| `refresh_token_nonce` | `bytea not null` |
| `encryption_key_version` | `integer not null check (> 0)` |
| `token_expires_at` | `timestamptz not null` |

The schema therefore already commits to: authenticated ciphertext with a separate nonce per secret, and a version number resolved at decryption time. This ADR selects the algorithm, key format, binding, and rotation procedure that fill that shape.

Constraints that shape the decision:

- **Refresh tokens live six months.** Confirmed against Spotify's refresh-token documentation and visible in the app dashboard as `Refresh Token Lifetime: 180 days`. Ciphertext therefore sits at rest for a long time and must resist offline attack.
- **Rotation is not guaranteed.** Spotify states that when a refresh token is not returned, the existing one continues to be used. Re-encryption must tolerate "no new refresh token".
- **Keys must live outside PostgreSQL.** The database plan places credentials in a non-exposed schema precisely so that database access alone is not sufficient to use them.
- **The deployment target is serverless.** There is no process-local cache that survives between invocations.

## Decision

### Algorithm

**AES-256-GCM** via `node:crypto`, in `lib/security/token-encryption.ts`.

- 256-bit key.
- 96-bit (12-byte) nonce from `crypto.randomBytes`, fresh per encryption, stored in the matching `*_nonce` column.
- 128-bit authentication tag appended to the ciphertext and stored in the `*_ciphertext` column.
- Decryption failure — wrong key, wrong version, tampered ciphertext, or wrong AAD — throws a typed `TokenDecryptionError` and never returns partial plaintext.

GCM is chosen because it is authenticated (AEAD), is available in the Node standard library with no added dependency, and supports additional authenticated data, which the binding below depends on.

### Binding via additional authenticated data

Each ciphertext is bound to its purpose and its row:

```
aad = `${purpose}|${subjectId}|${userId}|${keyVersion}`
purpose ∈ { "spotify.access_token", "spotify.refresh_token", "spotify.code_verifier" }
```

`subjectId` is the connection id for the two token purposes and the OAuth transaction id for `spotify.code_verifier`, which is sealed before any connection row exists. Both ids are generated in application code rather than by a column default, so the value is known before encryption.

This makes a ciphertext non-portable. An attacker with write access to the credentials table cannot move a refresh-token ciphertext into another user's row, cannot swap it into the access-token column, and cannot replay a captured PKCE verifier into a different OAuth transaction. Without AAD, all three substitutions decrypt cleanly.

### Key format and provisioning

- `SPOTIFY_TOKEN_ENCRYPTION_KEY` — base64, decoding to exactly 32 bytes. Validation in `lib/validation/environment.ts` is tightened to enforce the decoded length rather than the current `min(1)` string check, and to require the key whenever `SPOTIFY_CLIENT_ID` is set.
- `SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION` — positive integer, currently `1`, written into `encryption_key_version` on every insert.
- Generated with `crypto.randomBytes(32)` and held in deployment secret management. It is not derived from, and never equal to, any provider credential or Supabase key.

### Rotation procedure

Versioned rather than in-place, so rotation is never a stop-the-world migration:

1. Add the new key as `SPOTIFY_TOKEN_ENCRYPTION_KEY_V<n+1>` alongside the current one and bump `SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION` to `n+1`.
2. Decryption resolves the key by the row's `encryption_key_version`, so old and new rows coexist.
3. All new writes — and any refresh that touches a row — encrypt under `n+1` and update the row's version.
4. A background re-encryption pass migrates rows still on `n`.
5. When no row reports version `n`, retire the old key.

Because every connection refreshes at least once an hour while in use, step 3 migrates active users without a dedicated pass. Only dormant connections need step 4.

**Compromise response** is deliberately different from routine rotation: rotating the key does not invalidate tokens Spotify still honours. A suspected key compromise requires destroying all ciphertext and forcing every user to reconnect, because the refresh tokens themselves must be presumed exposed.

## Resolved: the access token is persisted, encrypted

`access_token_ciphertext` is `not null`, so the Phase 2 schema requires an access token to be stored. This conflicted with `docs/compliance/spotify-compliance.md`, which listed "Persist access tokens" under things CrateCompass does not do.

**Decision (approved 2026-08-04): persist the encrypted access token; keep the Phase 2 schema unchanged; correct the compliance wording.**

The deployment target is serverless, so there is no memory shared between invocations. Without a stored access token every cold start spends a refresh call before doing any work, which burns Development Mode quota — since July 2026 a budget shared across every app under the developer account — for no security gain. The access token receives protection identical to the refresh token: AES-256-GCM, AAD-bound to its row and purpose, non-exposed schema, reachable only by `service_role`, destroyed on disconnect, and already expired within an hour by `token_expires_at`.

The rejected alternative was making the access-token columns nullable and holding access tokens in memory only. It keeps the compliance sentence literally true and shrinks the at-rest surface to the refresh token alone, at the cost of a migration and one refresh round-trip per cold start. The security difference is small; the quota difference is not.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| `pgsodium` / Supabase Vault | Puts key material in, or adjacent to, the database the ciphertext lives in, defeating the separation the private schema exists to create. Also adds a managed-extension dependency to every migration. |
| AES-256-CBC + separate HMAC | Equivalent security only if composed correctly; GCM provides authentication natively and removes the encrypt-then-MAC ordering pitfall. |
| Application-wide key with no version column | The schema already has `encryption_key_version`, and rotation without it requires downtime. |
| Storing tokens in plaintext in the private schema | A database read becomes full account access. Explicitly forbidden by the compliance plan. |
| Per-user derived keys (HKDF from a master key + user id) | AAD binding achieves the same non-portability without adding a derivation step to every operation and without complicating rotation. |

## Consequences

- No new runtime dependency; `node:crypto` only.
- Encryption and decryption become the single choke point for every Spotify credential, so redaction and error handling are enforced in one file rather than at each call site.
- Rotation is operationally routine and needs no downtime.
- A lost encryption key is unrecoverable: every user must reconnect. This is intentional — the alternative is a recoverable key, which is a key an attacker can also recover.
- Decryption failure is always fatal to the operation and always surfaces as a reconnect prompt, never as a silent retry.

## Verification

- Round-trip encrypt/decrypt for all three purposes.
- Tampered ciphertext, tampered nonce, and truncated tag each rejected.
- Wrong-AAD rejection proved for all three substitutions: cross-user, cross-purpose, cross-transaction.
- Wrong key version rejected.
- Nonce uniqueness across repeated encryptions of identical plaintext.
- Key-length validation rejects non-32-byte input at environment-validation time.
- Log-capture assertions prove no plaintext token, ciphertext, or key appears in any log line.
