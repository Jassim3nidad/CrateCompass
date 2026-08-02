# CrateCompass Threat Model

Status: Phase 0 baseline  
Last reviewed: 2026-08-02  
Method: STRIDE-informed data-flow review

## Scope

This model covers the browser, Next.js application, Supabase Auth/PostgreSQL, OAuth connection, MusicBrainz, discovery provider, Spotify, AI providers, logs, deployment configuration, and deletion lifecycle. It does not yet cover implementation-specific dependencies or infrastructure settings that do not exist in Phase 0.

## Security objectives

1. A user can access and modify only their own application data.
2. Provider credentials and tokens remain server-only and do not enter logs.
3. Spotify content never enters an AI provider.
4. OAuth cannot be forged, replayed, cross-linked, or redirected off-site.
5. External data and AI output cannot bypass validation or cause injection.
6. Playlist creation and deletion are intentional, idempotent, and recoverable.
7. Account disconnection/deletion reliably removes credential usability and user-owned data.
8. Provider outages, quotas, and malformed responses fail honestly without fabricated data.

## Assets

- Supabase sessions and user identities.
- Spotify OAuth codes, access tokens, refresh tokens, and account links.
- Provider and AI API keys.
- Token-encryption keys and key versions.
- User-authored moods, preferences, questions, notes, and history.
- Saved discoveries and generated-playlist records.
- Provider provenance and canonical music identifiers.
- RLS policies, migrations, server authorization logic, and AI boundary code.
- Availability quota for Spotify, MusicBrainz, Last.fm, AI, and the application.
- User trust in factual explanations and explicit playlist approval.

## Adversaries and failure actors

- Anonymous internet attacker.
- Authenticated malicious user attempting cross-tenant access.
- Attacker controlling a submitted string, callback parameter, or provider-like payload.
- Compromised browser extension or shared device.
- Malicious or malformed external provider response.
- Prompt-injection content in user text or external metadata.
- Accidental developer misuse, import coupling, logging, or configuration error.
- Compromised dependency, build pipeline, deployment credential, or service account.
- Provider outage, quota enforcement, API change, or token revocation.

## Trust-boundary threats and mitigations

| ID | Threat | Impact | Primary mitigations | Verification |
| --- | --- | --- | --- | --- |
| T01 | Credential or token leaks to browser bundle | Provider/account compromise | Server-only modules, no secret-prefixed public env vars, bundle scanning, narrow DTOs | Build artifact scan and client import test |
| T02 | Token appears in logs/errors | Persistent credential exposure | Central redactor, safe error types, prohibit raw bodies/headers, log-capture tests | Synthetic canary secret test |
| T03 | Cross-user database access | Privacy/integrity breach | RLS on every user table, owner from session, composite ownership constraints | Anonymous/owner/cross-user pgTAP tests |
| T04 | Service-role key exposed or overused | RLS bypass and database takeover | Server secret only, isolated module, minimal admin routes, key rotation | Secret scan and import/deployment review |
| T05 | OAuth login CSRF/account-link swapping | Victim links attacker account or vice versa | Signed-in prerequisite, random state hash, PKCE, user-bound transaction, atomic one-time consume | Callback integration tests |
| T06 | OAuth code/state replay | Unauthorized relinking/token exchange | Short expiry, consumed marker, exact redirect, single-use transaction | Replay and expiry tests |
| T07 | Open redirect through OAuth return path | Phishing/session leakage | Local path allowlist, never accept arbitrary origin | Fuzz route/callback tests |
| T08 | Refresh-token database disclosure | Long-lived Spotify access | Authenticated encryption, key outside DB, private schema, versioned rotation | DB role tests and encryption round-trip tests |
| T09 | Concurrent refresh overwrites rotated token | Connection loss or invalid credential reuse | Row/advisory lock or compare-and-swap, atomic rotation | Concurrency integration test |
| T10 | Disconnected account refreshes again | User-control/privacy failure | Mark disconnected before destruction, refresh guard, ciphertext deletion | Disconnect-versus-refresh race test |
| T11 | Spotify content reaches AI | Contract/compliance breach | Separate types, provenance, exact schemas, recursive forbidden-value scan, dependency rules | Negative/property/integration tests with outbound spy |
| T12 | Indirect Spotify-derived text bypasses key scan | Compliance breach | Provenance required at creation, taint-like nominal wrapper, allowlisted construction rather than denylist alone | Type tests and mixed-provenance fixtures |
| T13 | Prompt injection changes tool/data policy | Data leakage or fabrication | AI has no provider tools/secrets, bounded context, structured output, no executable instructions from metadata | Adversarial prompt tests |
| T14 | AI fabricates music facts/evidence | User harm/trust loss | Retrieved context, source IDs, strict output schema, reference completeness check, honest fallback | Golden and invalid-output tests |
| T15 | Malformed provider response poisons application | XSS, crashes, incorrect matching | Treat providers as untrusted, Zod parse, output encoding, URL/host allowlists | Contract fixtures and fuzz tests |
| T16 | Stored/reflected XSS in names or notes | Session/data compromise | React escaping, no unsafe HTML, URL validation, CSP | Unit/E2E security tests |
| T17 | CSRF on mutations | Unauthorized saves, disconnect, deletion, playlist creation | SameSite cookies, origin checks/framework protections, POST-only mutation, recent auth for destructive action | Cross-origin tests |
| T18 | Duplicate playlist creation on retry | Unwanted external mutation | Idempotency key/fingerprint, operation reservation, persisted recovery state | Timeout/retry integration tests |
| T19 | Partial playlist leaves inconsistent state | Confusing duplicates/data loss | Persist playlist ID before item batches, partial status, repair instead of recreate | Injected failure test per batch |
| T20 | Provider/API quota exhaustion | Denial of service | Per-user/global limits, caching when permitted, request coalescing, Retry-After, bounded concurrency | 429/quota simulation and load test |
| T21 | MusicBrainz client exceeds one request/second | Blocking/service harm | Central scheduler, meaningful User-Agent, cache/coalescing | Timing test and header assertion |
| T22 | Enumeration or abuse of search/AI endpoints | Cost and availability loss | Authentication where appropriate, rate and input limits, generic errors | Rate-limit tests |
| T23 | Account deletion is incomplete | Privacy/legal failure | Credential destruction first, cascade/reviewed function, idempotent job, completion audit | End-to-end deletion and residual-data query |
| T24 | Dependency or CI compromise | Secret/code compromise | Lockfile, review automation, least-privilege CI, dependency/secret scanning, protected production env | CI policy and supply-chain review |
| T25 | Preview environment uses production data/secrets | Data leakage | Isolated config/projects, environment-scoped secrets, deployment checks | Preview smoke and config tests |
| T26 | Spotify artwork is copied or altered | Policy/copyright breach | Never download/rehost; render supplied URL as allowed with attribution/link; no transforms | Code search and UI contract tests |
| T27 | Unsafe fuzzy match selects wrong artist/track | Wrong playlist and misleading attribution | Deterministic thresholds, tie detection, user confirmation | Ambiguity fixture suite |
| T28 | Sensitive user text is sent unnecessarily to AI | Privacy/cost exposure | Data minimization, disclosure, truncation, no history-by-default context, redacted logs | Adapter payload snapshot tests |

## AI-specific abuse cases

- A user includes `spotify:track:` or an Spotify URL in a mood. The AI gateway rejects or removes the prohibited request before any provider call and asks for provider-neutral text.
- A developer passes a `SpotifyResolution` to a title generator because it is convenient. Type checks fail; runtime provenance validation also rejects it.
- Last.fm or MusicBrainz text contains instructions to reveal secrets. It is treated as quoted data, the AI adapter has no access to secrets/tools, and structured output is validated.
- An AI returns an artist or release not present in supplied evidence. Reference validation rejects the output and uses an honest failure/template.

## Privacy analysis

Data minimization choices:

- Do not import Spotify listening history, top items, saved library, or existing playlists.
- Do not request Spotify email/private-profile scopes for the MVP.
- Store the current stable Spotify `account_id`, connection status, scopes, operational playlist IDs, and encrypted refresh token only.
- Do not store access tokens, raw provider responses, Spotify images, or full playlist contents.
- Keep user prompts out of routine logs.
- Make history deletion and account deletion accessible from settings.

Before implementation, publish a privacy notice describing each provider, purpose, data category, retention, user control, and international processing where applicable.

## Security test plan

- Static checks: strict TypeScript, lint rules for server-only imports, dependency graph tests, secret scanning, and vulnerable-dependency review.
- Database: migration reset, grants, RLS, ownership immutability, private-schema denial, and security-definer tests.
- Authentication: session fixation, stale session, protected routes, callback tampering, password/reset flows, and recent-auth checks.
- OAuth: state mismatch, replay, expiry, verifier mismatch, denied consent, 401/403, revoked refresh token, rotation, and concurrent refresh.
- AI boundary: forbidden strings/keys at arbitrary depths, Spotify-provenance types, mixed objects, oversized input, invalid structured output, and zero outbound call on rejection.
- Provider contracts: malformed JSON, missing fields, unknown fields, timeouts, 429, 5xx, and retry budgets.
- Web: CSRF, redirect allowlists, XSS, CSP, cookie attributes, error disclosure, and rate limiting.
- Workflows: duplicate creation, partial playlist, disconnect race, deletion retry, and residual-data checks.

## Operational requirements

- Maintain an incident procedure for leaked credentials, Spotify compliance breach, cross-user access, and AI-boundary failure.
- Rotate provider/database secrets independently.
- Version refresh-token encryption and test key rotation before live use.
- Alert on unusual auth failures, AI-boundary rejections, playlist duplicate prevention, and provider quota exhaustion without including user content.
- Review current provider documentation and terms before each production release.

## Residual risks and gates

- Provider terms and APIs can change without synchronized documentation.
- Spotify extended access is not assured, limiting launch scale.
- Last.fm commercial/AI-processing permission must be confirmed before those uses.
- Community-maintained MusicBrainz data can be incomplete.
- No encryption design prevents application-server compromise from using secrets available to that server; runtime hardening and least privilege remain required.
- Threat modeling must be repeated after Phase 1 dependencies and deployment topology exist and after each provider integration.

