# CrateCompass security audit

Phase: 11 · Date: 2026-08-10 · Commit audited: `4619141`
Auditor: automated review with manual verification of every finding below.
Scope: application code, database policies, provider integrations, dependencies.
Out of scope: hosting configuration, DNS, Vercel account security, Supabase
project-level settings.

---

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 4 |
| Informational | 2 |

One High finding is a proven, exploitable open redirect in the authentication
flow. Everything else is hardening or operational readiness. The controls that
matter most in this codebase — the Spotify/AI boundary, RLS, PKCE, token
encryption at rest, and log redaction — were tested and hold.

---

## SEC-01 · Open redirect after authentication — **High**

**CWE-601. Reachable, and demonstrated end to end.**

`getSafeReturnPath` (`lib/security/safe-redirect.ts`) rejects a candidate that
begins `//`, then normalises the survivor through the WHATWG URL parser and
returns `url.pathname`. Path normalisation can *produce* a protocol-relative
path from one that did not start that way:

| Input | Guard output |
| --- | --- |
| `//evil.com` | `/discover` (rejected, correct) |
| `/..//evil.com` | `//evil.com` |
| `/a/..//evil.com` | `//evil.com` |
| `/%2e%2e//evil.com` | `//evil.com` |

The returned value is then resolved against a base URL by the caller, and
`new URL("//evil.com", "http://127.0.0.1:3000/x")` is `http://evil.com/`.

**Proven reachable** through `features/auth/actions.ts:93` (`signIn`) and
`:127` (`signUp`), both of which call `redirect(getSafeReturnPath(returnTo))`.
`returnTo` originates from the `?returnTo=` query parameter, is rendered into a
hidden form field by `features/auth/components/auth-form.tsx:70`, and reaches
the action unmodified.

Verified with a browser driving the real sign-in flow against the local stack.
Requesting `/auth/sign-in?returnTo=%2F..%2F%2Fexample.com` and authenticating
successfully produced an outbound navigation to `http://example.com/`, captured
by aborting all off-origin requests:

```
FINAL URL       : chrome-error://chromewebdata/   (navigation aborted by the probe)
OFFSITE ATTEMPTS: ["http://example.com/"]
```

**Impact.** A phishing link of the form
`https://<app>/auth/sign-in?returnTo=/..//attacker.example` shows the genuine
CrateCompass sign-in page on the genuine domain, accepts a real credential, and
then lands the authenticated user on an attacker page — the strongest position
a credential-harvesting or consent-phishing page can be launched from. It also
weakens the OAuth flows, where a trusted-origin redirector is a standard step in
authorization-code interception chains.

**Paths that are NOT affected**, checked individually:

- `app/auth/callback/route.ts:40` assigns to `destination.pathname`. The
  `URL.pathname` setter cannot change origin, so `//evil.com` becomes
  `http://<app>//evil.com` — same-origin. Safe.
- `app/api/integrations/spotify/callback/route.ts` passes the value through
  `getSafeReturnPath` a *second* time, at store time
  (`features/spotify/actions.ts:84`) and again at callback time. The first pass
  emits `//evil.com`; the second rejects it on the `startsWith("//")` check.
  Safe **by accident** — nothing documents or tests this, and collapsing the
  double call during a future refactor would open it.

**Remediation.** Re-check the guard's own output before returning it, so
normalisation cannot smuggle a value past the input check:

```ts
const path = `${url.pathname}${url.search}${url.hash}`;
return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
```

`tests/unit/safe-redirect.test.ts` covers `//example.com` but no normalising
input; add `/..//evil.com`, `/a/..//evil.com` and `/%2e%2e//evil.com`, and
assert on the *resolved absolute URL* rather than the guard's return value,
since the guard's output is only safe in combination with how the caller uses
it.

---

## SEC-02 · No Content-Security-Policy — **Medium**

`next.config.ts` sets `Referrer-Policy`, `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Permissions-Policy`, and disables
`X-Powered-By`. There is no `Content-Security-Policy`.

No injection sink was found — the repository contains no
`dangerouslySetInnerHTML`, no `eval`, no `innerHTML` assignment, and no
`new Function` — so this is defence in depth rather than an exploitable gap
today. It matters because CSP is the control that limits the blast radius of a
future XSS or a compromised dependency, and because a nonce-based policy is
materially harder to retrofit after launch than to add now.

Recommend a policy covering `default-src 'self'`, the Supabase origin in
`connect-src`, `i.scdn.co` in `img-src` (Spotify artwork must be hot-linked, not
rehosted), and `frame-ancestors 'none'` to duplicate the frame protection in a
modern directive.

---

## SEC-03 · No application-level rate limiting — **Medium**

`RATE_LIMIT_STORE_URL` and `RATE_LIMIT_STORE_TOKEN` are declared and validated
in `lib/validation/environment.ts:67-68` and **read by no module in the
repository**. Configuration that names a control which does not exist is worse
than no configuration, because it reads as coverage during review.

What does exist: AI usage is metered per user in Postgres (20/day, 4/minute,
`claim_ai_usage`, fails closed); MusicBrainz is paced at 1 req/s globally.
Neither is a request-rate control.

What is unprotected: sign-in, sign-up and password-reset submissions, and every
server action, rely entirely on Supabase GoTrue's built-in limits. Those are
real but are not tuned here, not asserted by any test, and not visible in this
codebase. Discovery and discography routes call paced external providers, so a
modest request flood becomes a queue rather than a cost, but it is still an
availability lever for an unauthenticated caller.

Either implement the limiter the variables imply, or delete the variables and
record the reliance on GoTrue explicitly.

---

## SEC-04 · Security audit trail is declared but never written — **Medium**

`private.security_events` is created in
`supabase/migrations/20260802160000_phase_2_auth_and_data.sql:187`, indexed on
`(user_id, created_at desc)`, and has RLS enabled. **No application code writes
a row to it.**

The events that would populate it are already detected and are currently emitted
to stdout only: `spotify.callback.state_rejected`,
`spotify.callback.session_mismatch`, `spotify.callback.insufficient_scope`,
`spotify.oauth.token_request_failed`, and account deletion. On Vercel, stdout is
retained for a limited window and is not queryable per user, so there is no
durable answer to "what happened to this account" — the question an incident
actually asks.

Either write the security-relevant events, or drop the table so the schema stops
implying a capability that is absent.

---

## SEC-05 · Prompt-injection neutralisation is applied to one of two model paths — **Medium**

Cross-referenced in the AI audit as AI-02. Recorded here because the untrusted
input is third-party data reaching a system that acts on text.

`lib/discography/sanitize.ts` is careful and well-reasoned: control and
invisible characters stripped, whitespace collapsed, length capped, identifiers
constrained to a plausible MBID shape, instruction-shaped text flagged but never
blocked. It is applied on the **discography Q&A** path.

The **explanation** path does not use it. `explainArtistMatchUserContent`
(`lib/ai/prompts.ts:28`) interpolates `seedArtistName`, `candidateArtistName`,
`fact.statement` and `release.title` straight into the prompt. Those values come
from MusicBrainz and ListenBrainz, which are community-edited.

Residual controls are genuine and reduce this from High to Medium: the output is
verified after the fact by `lib/discovery/explanation.ts`, which requires every
`groundedIn` entry to match a supplied evidence statement and every
`startingPointReleaseId` to be one of the supplied identifiers, and falls back
to a deterministic template when either check fails. A manipulated *citation* is
therefore caught. A manipulated *summary* — prose the model was steered into
writing — is not obviously caught by a token-overlap check, and the summary is
the part a listener reads.

Apply `sanitizeField` to the explanation path's provider-supplied strings.

---

## SEC-06 · `LOG_LEVEL` is validated but never enforced — **Low**

`LOG_LEVEL` is a required, enum-validated environment variable
(`lib/validation/environment.ts:34`). `lib/observability/logger.ts:66` writes
every record regardless of it; there is no level comparison anywhere. Setting
`LOG_LEVEL=error` in production changes nothing.

Impact is currently small — there is exactly one `logger.debug` call site — but
the variable is a false assurance, and the blast radius grows with every debug
line added on the assumption that it can be switched off.

---

## SEC-07 · Vulnerable transitive dependency, build-time only — **Low**

```
cratecompass@0.1.0
`-- @tailwindcss/postcss@4.3.3   (devDependency)
  `-- postcss@8.5.25             (pinned by "overrides")
    `-- nanoid@3.3.16
```

GHSA-2v37-7h3g-55p8, rated high by npm: a custom nanoid generator can loop
indefinitely when size is zero. Fixed in 3.3.17.

Downgraded to Low here on reachability. The package is reached only through a
devDependency used by the CSS build, never ships in the runtime bundle, and the
defect requires calling nanoid with a custom generator and a zero size, which no
code in this repository does. `npm audit fix` resolves it; the existing
`overrides` block pins `postcss`, not `nanoid`, so the bump is independent of
that pin.

---

## SEC-08 · No `Strict-Transport-Security` header from the application — **Low**

Not set in `next.config.ts`. Vercel serves HSTS on its own domains, so in the
intended deployment this is likely covered at the edge — which is exactly why it
should be confirmed rather than assumed, and why it should be set explicitly for
any custom domain or non-Vercel target.

---

## SEC-09 · Sanitiser escaping does not match the envelope it feeds — **Low**

`sanitizeField` escapes `\` and `"`, which is correct for a value carried in a
quoted, delimited field. The prompts that consume the result render it in an
unquoted pipe-separated line:

```
- id=${release.id} | ${release.title} | ${release.primaryType} | ${release.firstReleaseDate}
```

So the quote escaping does nothing in the format actually used, while the
module's own documentation describes delimiting as "blocking, and does the
actual work". The parts that do work — control-character stripping, invisible-
character removal, whitespace collapse, the 300-character cap, the identifier
constraint — are unaffected.

Either carry the fields in a genuinely quoted envelope (JSON), or drop the quote
escaping and correct the comment. The pipe character itself is not escaped, so a
title containing `|` can currently forge an extra column.

---

## SEC-10 · Four copies of compliance-critical system prompts — **Informational**

`DISCOGRAPHY_SYSTEM`, `MOOD_SYSTEM` and `PLAYLIST_TEXT_SYSTEM` are declared
separately in each of the OpenAI, Anthropic, Gemini and OpenRouter adapters. All
four copies of `DISCOGRAPHY_SYSTEM` are currently byte-identical (verified by
hashing each block), so there is no defect today.

It is recorded because `lib/ai/prompts.ts` exists precisely to prevent this and
says so in its own header — "its wording is a compliance surface … Four copies
would drift" — while holding only the explanation prompt. The stated policy and
the actual layout disagree, and the drift the comment warns about is one careless
edit away.

---

## SEC-11 · Stale phase reference in a shipped module comment — **Informational**

`lib/privacy/user-data.ts:13` defers the export download to "Phase 12". After
the Phase 10 renumbering there is no Phase 12 in the roadmap. Documentation
only; no behavioural impact.

---

## Controls verified as effective

Each of these was read and, where noted, exercised.

**Authentication and session handling.** Supabase Auth is the sole application
identity; Spotify is a connected account and cannot authenticate. Cookie-based
sessions are managed by `@supabase/ssr`. The proxy verifies claims
(`supabase.auth.getClaims()`) before allowing `/library`, `/history` and
`/settings`; page and action code re-checks with `auth.getUser()` rather than
trusting the middleware. Anonymous access to protected routes redirects to
sign-in — asserted by end-to-end tests.

**OAuth, CSRF and PKCE.** Authorization Code with PKCE, `S256`, verifier of 64
random bytes (86 base64url characters, inside RFC 7636's 43–128). No client
secret is read anywhere; a compliance test asserts no module names the variable.
State is stored as a SHA-256 digest only, so a database reader cannot mint a
passing state. The callback claims the transaction atomically and single-use, so
replay, tampering, expiry and unknown state are indistinguishable. The
transaction is bound to the initiating user and a callback delivered into a
different session is refused. Server actions are protected against cross-origin
POST by the framework's built-in Origin/Host check.

**Token encryption at rest.** AES-256-GCM with a 12-byte random nonce and a
16-byte tag. Additional authenticated data binds every ciphertext to
`purpose|subjectId|userId|keyVersion`, so a ciphertext moved between users,
columns or transactions fails authentication instead of decrypting. Key version
mismatch, malformed nonce and truncated ciphertext are rejected before any
crypto call. The underlying decryption error is deliberately swallowed so key
and ciphertext detail cannot reach a log.

**Secret handling and boundaries.** Every privileged module carries
`server-only`. The service-role key is used only through `createAdminClient`.
`service_role` holds no table grants; privileged work goes through
`security definer` RPCs (`claim_ai_usage`, `read_ai_usage_remaining`,
`export_user_data`) granted to `service_role` alone.

**Row Level Security.** All 15 tables across `public` and `private` have RLS
enabled — verified by enumerating every `create table` and matching it against
an `enable row level security` statement, with no misses. 140 pgTAP assertions
across 6 files cover owner, cross-user, anonymous, ownership-mutation and
child-parent access.

**Input validation.** Every server action that accepts input validates it with
Zod before use. The three that do not parse take no arguments
(`deleteAllHistoryAction`, `connectSpotify`, `disconnectSpotify`); the fourth,
`reconnectSpotify`, takes a path handled by the redirect guard — see SEC-01. All
external provider responses are parsed with Zod schemas.

**Output encoding.** No `dangerouslySetInnerHTML`, `eval`, `innerHTML`
assignment or `new Function` anywhere in `app`, `components`, `features` or
`lib`. All rendering goes through React's escaping.

**SSRF.** Every outbound origin is a hard-coded module constant —
`api.spotify.com`, `accounts.spotify.com`, `musicbrainz.org`,
`labs.api.listenbrainz.org`, `openrouter.ai`, and the configured AI provider's
base URL. No user-supplied value can influence a host. Path and query segments
are built with `URLSearchParams` or `encodeURIComponent`. All fetches set an
`AbortSignal.timeout` and `cache: "no-store"`.

**Log redaction.** `redactSensitive` masks any key matching
`/authorization|cookie|password|secret|token|api[-_]?key|ciphertext|code_verifier|prompt|input_text/i`
recursively, with a narrow allowlist that exempts a fixed set of usage-count
keys and only when the value is a number — an exemption that cannot leak a
credential because a number cannot be a bearer token. The OAuth failure path
logs a reason code, never the response body, which can echo the code, the
verifier and the refresh token.

**Error disclosure.** Server actions return fixed, non-enumerating messages.
Sign-in failure does not distinguish wrong password from unknown account or
unconfirmed email. Password reset always reports the same outcome — asserted by
an end-to-end test. Provider errors are mapped to a closed set of kinds; raw
provider bodies and stack traces are never returned to the browser.

**Account deletion.** Requires the current password (re-authentication) and a
typed confirmation. Deletion goes through the admin API and cascades to every
owned row. `export_user_data` enumerates every table with a foreign key to
`auth.users` — keyed on the foreign key, not on a column named `user_id`, which
is what keeps `profiles` in scope — and a pgTAP assertion requires it to return
nothing after deletion. That is the residual-data check the threat model commits
to as T23.

---

## Recommended remediation order

1. **SEC-01** before any deployment reachable from the internet. Small, local
   fix plus tests.
2. **SEC-05** next; it is a one-line reuse of a module that already exists.
3. **SEC-02**, **SEC-03**, **SEC-04** as a hardening set before the private
   pilot opens beyond the operator.
4. **SEC-06** through **SEC-11** at convenience.
