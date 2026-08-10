# CrateCompass test report

Phase: 11 · Date: 2026-08-10 · Commit: `4619141`
Environment: Windows 11, Node 24.13.0, npm 11.6.2, local Supabase on rootless
Podman, Playwright 1.62 (Chromium + Pixel 7 emulation).

Every command below was executed in this audit. Nothing is quoted from a prior
run.

---

## Results

| Gate | Command | Result |
| --- | --- | --- |
| Format | `npm run format:check` | **Pass** — exit 0, all files match |
| Lint | `npm run lint` | **Pass** — exit 0, `--max-warnings=0` |
| Type-check | `npm run typecheck` | **Pass** — exit 0, strict + `exactOptionalPropertyTypes` |
| Unit + integration + contract + compliance | `npm test` | **Pass** — 590 passed, 33 skipped, 39 files |
| Contract + compliance (isolated) | `npx vitest run tests/compliance tests/contract` | **Pass** — 110 passed, 3 files |
| Database schema | `npm run db:reset` | **Pass** — 11 migrations apply from empty |
| RLS / pgTAP | `npm run db:test` | **Pass** — 140 assertions, 6 files |
| Database lint | `npm run db:lint` | **Pass** — no schema errors |
| Live database | `LIVE_DATABASE=1 npx vitest run tests/live` | **Pass** — 24 passed |
| Live providers | `LIVE_PROVIDERS=1 npx vitest run tests/live/providers-live.test.ts` | **Pass** — 9 passed |
| End-to-end | `npx playwright test --grep-invert @a11y` | **Pass** — 193 passed, 0 failed, 67 skipped |
| Accessibility | `npx playwright test --grep @a11y` | **Pass** — 54 passed, 0 failed |
| Production build | `npm run build` | **Pass** — exit 0, 18 routes |
| Dependency audit | `npm audit` | **1 high** — see SEC-07 |
| Lighthouse | `npx lighthouse@12` against `next start` | **Pass** — see below |

**No test failed in this audit.**

The 67 skipped end-to-end cases are the responsive width matrix skipping on the
mobile project, which pins a device viewport and would otherwise measure the
same width seven times. The 33 skipped unit cases are the two opt-in live suites
(`LIVE_DATABASE`, `LIVE_PROVIDERS`), which are run separately above.

---

## Lighthouse

Production build (`npm run build` then `next start`), headless Chromium,
Lighthouse 12.8.2.

| Route | Performance | Accessibility | Best practices | SEO | CLS | LCP |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | 94 | 100 | 100 | 100 | 0 | 2.2 s |
| `/discover` | 93 | 100 | 100 | 100 | 0 | 2.4 s |
| `/artists/{mbid}` | 96 | 100 | 100 | 100 | 0 | 2.6 s |

Measured against a local server on the audit machine, so the performance figure
reflects this hardware, not production. Accessibility, best practices, SEO and
CLS are environment-independent and are the numbers worth carrying forward.

**Note on the tooling.** `chrome-launcher` raises `EPERM` while removing its
temp directory on Windows *after* the report is written. The run completes and
the JSON is valid; the error is cleanup only.

---

## What the suite actually covers

Counts are a poor proxy for coverage, so this is what the 590 + 193 + 54 cases
assert, by concern.

**The Spotify/AI boundary — 110 contract and compliance assertions.** Both AI
adapters pass the same contract suite. Property tests push nested Spotify keys,
URIs, URLs, hosts, identifiers, tokens, mixed provenance and oversized payloads
through `buildAiInput`. An outbound spy proves zero AI calls are made for
rejected input. A repository scan asserts the ESLint boundary rules, the log
redaction pattern, the fixture gate, and the absence of the deprecated
playlist-tracks path.

**Row Level Security — 140 pgTAP assertions.** Owner, cross-user, anonymous,
ownership-mutation, child-parent and private-schema access, across all six
phase migrations. Includes the residual-data assertion (T23): after account
deletion, `export_user_data` must return nothing, and a column-level check
requires every user-owned table to appear in the enumeration, so a table added
later fails the suite until registered.

**Authentication and OAuth.** State replay, tampering, expiry and unknown-state
rejection; verifier sealing; concurrent refresh; rotation; revocation;
disconnect race; insufficient scope; open-redirect rejection for the inputs the
existing test covers (see the caveat below).

**Accessibility — 54 cases.** Ten anonymous routes and four authenticated
routes scanned with axe; hovered, expanded and open-menu states scanned as
states; keyboard order, focus visibility, keyboard-trap sweep, mobile-menu
dismissal, reduced motion, 200% reflow and WCAG 2.2 target size asserted
programmatically.

**Responsive — 63 overflow cases.** Nine routes at seven widths from 320 to
1920, asserting `scrollWidth <= clientWidth` and naming the widest offending
element on failure.

---

## Coverage gaps this audit found

These are gaps in the test suite, not failures. Each is a case that would pass
today and should exist so it keeps passing.

**TEST-01 · The open-redirect test does not cover normalising input — High.**
`tests/unit/safe-redirect.test.ts` asserts `//example.com`,
`https://example.com`, `javascript:` and `null` are rejected. It does not assert
`/..//evil.com`, which **is** accepted and is the live vulnerability recorded as
SEC-01. The test suite passing is therefore not evidence the guard is sound. The
missing case is the finding; the passing suite is what let it survive.

Additionally, the existing test asserts the guard's *return value*. Because
safety depends on how each caller composes that value with a base URL, the
assertion should be on the resolved absolute URL for at least one caller.

**TEST-02 · No test asserts the double-sanitisation the Spotify callback relies
on — Medium.** The Spotify callback is safe from SEC-01 only because
`getSafeReturnPath` runs twice: once at store time and once at callback time.
Nothing documents or tests that, so a refactor collapsing the two calls would
open the vulnerability with the whole suite still green.

**TEST-03 · Prompt-injection coverage follows the sanitiser, not the boundary —
Medium.** `tests/unit/discography-sanitize.test.ts` covers the sanitiser
thoroughly. No test asserts that *every* provider-supplied string reaching a
model has been through it, which is why the explanation path (SEC-05) is
unsanitised with the suite passing.

**TEST-04 · One load-sensitive end-to-end case — Low.** Carried from Phase 10.
`library.spec.ts` "undo puts the item back" failed once under full-suite load,
then passed 3/3 in isolation and in both full runs since, including this audit's.
Root cause is dev-server compile contention, not product behaviour. The
underlying asymmetry — `retries: 0` locally against `retries: 2` in CI — still
means a marginal case fails on a developer machine and passes in CI.

**TEST-05 · No continuous integration — High for release readiness.** There is
no `.github/` directory and no CI configuration of any kind. Every gate in this
report was run by hand. Nothing prevents a commit that fails lint, type-check,
RLS or the compliance suite from reaching `master`, and the Spotify/AI boundary
— the product's defining constraint — is enforced by a test that nothing
automatically runs.

---

## Reproduction

```bash
# Infrastructure (rootless Podman; see docs/setup/local-database.md)
podman machine start
podman machine ssh "systemd-run --user --unit=podman-tcp --collect podman system service --time=0 tcp://127.0.0.1:2375"
export DOCKER_HOST=tcp://127.0.0.1:2375
npx supabase start -x edge-runtime,studio,imgproxy,logflare,vector,mailpit,realtime,storage-api,supavisor

# Static gates
npm run format:check && npm run lint && npm run typecheck

# Tests
npm test
npm run db:reset && npm run db:test && npm run db:lint
LIVE_DATABASE=1 npx vitest run tests/live
LIVE_PROVIDERS=1 npx vitest run tests/live/providers-live.test.ts
npx playwright test --grep-invert @a11y
npx playwright test --grep @a11y

# Build
npm run build
```

`npm run format:check | tail` masks the exit code — check `$?` directly.
