# CrateCompass release readiness

Phase: 11 · Date: 2026-08-10 · Commit: `4619141`
Question answered: **is this ready for a private pilot with real listeners?**

---

## Verdict

# NO-GO for a pilot with any user other than the developer.

Two findings block, both small and both specific. Neither is architectural.

| # | Blocker | Severity | Effort |
| --- | --- | --- | --- |
| 1 | **SEC-01** — open redirect after authentication, proven exploitable | High | ~1 hour including tests |
| 2 | **SPC-01** — no published privacy policy or terms | High | Drafting, not engineering |

**GO for continued development, and GO for a single-operator smoke test** on the
existing Development Mode application. Nothing found puts existing data at risk,
and no finding requires reworking a design decision.

The distance to GO is short. This is a codebase whose hard parts — the
Spotify/AI boundary, RLS, PKCE, token encryption, deletion — were built
carefully and hold up under inspection. What is missing is the layer around
them: published policy, CI enforcement, and a durable audit trail.

---

## Blocker 1 — SEC-01, open redirect

`getSafeReturnPath` rejects a path starting `//`, then normalises through the
URL parser, and normalisation can produce `//evil.com` from `/..//evil.com`.
Reachable through `?returnTo=` on sign-in and sign-up. Demonstrated end to end:
after a genuine authentication on the genuine domain, the browser navigated to
an external origin.

This blocks a pilot specifically because a pilot means sending links to people.
A link that shows the real sign-in page and then lands the user somewhere else
is the exact primitive credential phishing needs, and it is more dangerous in an
OAuth application than in a plain one.

Fix and required tests are specified in `security-audit.md`. Add the missing
cases from TEST-01 at the same time — the vulnerability survived because the
test file asserts the inputs someone thought of, not the class.

---

## Blocker 2 — SPC-01, no published privacy policy

There is no `/privacy`, `/terms` or `/legal` route. The footer's "Privacy" link
points at `/settings`. The substance exists in
`docs/security/data-handling.md`, unpublished.

A privacy policy is a standing requirement for a Spotify application, and it is
the first artefact any quota or extension review asks for. More directly: a
listener connecting a Spotify account is granting write access to their
playlists without a stated policy describing what is held, who processes it, or
how to get it deleted. The product's whole argument is transparency about where
data comes from and where it goes, and not publishing that is off-message as
well as non-compliant.

---

## Full finding inventory

Across all four audit documents.

| Severity | Count | Findings |
| --- | --- | --- |
| Critical | 0 | — |
| High | 4 | SEC-01, SPC-01, TEST-01, TEST-05 |
| Medium | 9 | SEC-02, SEC-03, SEC-04, SEC-05, SPC-02, SPC-03, TEST-02, TEST-03, A11Y-01 |
| Low | 8 | SEC-06, SEC-07, SEC-08, SEC-09, SPC-04, TEST-04, A11Y-02, A11Y-03 |
| Informational | 6 | SEC-10, SEC-11, SPC-05, SPC-06, A11Y-04, A11Y-05 |

27 findings across the four documents.

TEST-01 and TEST-05 are rated High as *release-readiness* findings rather than
as live vulnerabilities: TEST-01 is the gap that let SEC-01 through, and TEST-05
means no gate is enforced automatically.

---

## Readiness by area

| Area | State | Note |
| --- | --- | --- |
| Spotify/AI boundary | **Ready** | Four independent enforcements, all verified |
| Row Level Security | **Ready** | 15/15 tables, 140 pgTAP assertions |
| Authentication & OAuth | **Ready except SEC-01** | PKCE, single-use state, session binding all correct |
| Token encryption | **Ready** | AES-256-GCM with AAD binding to purpose, subject, user, key version |
| Account deletion & data rights | **Ready** | Re-auth required, cascade verified by residual-data assertion |
| Input validation | **Ready** | Zod on every action taking input, and on every provider response |
| Output encoding | **Ready** | No `dangerouslySetInnerHTML`, `eval`, `innerHTML` or `new Function` |
| Accessibility | **Ready** | WCAG 2.2 AA, no known violations, Lighthouse 100 |
| Endpoints & scopes | **Ready** | Four endpoints, two scopes, no deprecated API |
| Legal documents | **Not ready** | SPC-01, SPC-03 |
| Security headers | **Partial** | CSP and HSTS absent (SEC-02, SEC-08) |
| Rate limiting | **Not ready** | Config declared, control absent (SEC-03) |
| Audit trail | **Not ready** | Table exists, nothing writes to it (SEC-04) |
| CI enforcement | **Not ready** | No CI configuration exists (TEST-05) |
| Observability | **Not assessed** | Out of audit scope; no dashboards or alerts exist |
| Backups & recovery | **Not assessed** | Out of audit scope; relies on Supabase defaults |

---

## Path to GO

**Before any external user — required.**

1. Fix SEC-01 and add the TEST-01 cases.
2. Publish a privacy policy and terms; repoint the footer (SPC-01, SPC-03).
3. Confirm the Spotify application's Development Mode status and allowlist
   against the dashboard, rather than against the Phase 0 assumption (SPC-06).

**Before the pilot widens past a handful of accounts — strongly recommended.**

4. CI running every gate on push, with the compliance suite non-skippable
   (TEST-05). The Spotify/AI boundary is the product's defining constraint and
   is currently enforced only when someone remembers to run the tests.
5. Content-Security-Policy (SEC-02).
6. A real rate limiter, or deletion of the variables that imply one (SEC-03).
7. Write `private.security_events`, or drop the table (SEC-04).
8. Sanitise the explanation path's provider strings (SEC-05).
9. Resolve the Spotify branding question (SPC-02).

**Carryable.** Everything Low and Informational, plus A11Y-01 (contrast in
interaction states) and A11Y-02 (one screen-reader pass), both of which are
worth doing but neither of which blocks.

---

## Areas this audit did not cover

Stated so absence of a finding is not read as a clean bill.

- **Hosting and platform.** Vercel project settings, environment-variable
  storage, deployment protection, DNS, TLS configuration.
- **Supabase project settings.** GoTrue rate limits, password policy, session
  lifetimes, email templates, PITR and backup retention are all configured in
  the dashboard, not in this repository, and none was inspected.
- **Observability, alerting, runbooks, backup and restore rehearsal.** These
  were the scope of the roadmap's original Phase 11 and remain unaddressed.
- **Load and abuse testing.** No load test exists. SEC-03 is reasoned from code
  reading, not measured.
- **Legal review.** SPC-01 and SPC-02 identify missing artefacts and a question
  to answer; neither is a legal opinion.
- **Key rotation rehearsal.** The encryption scheme carries a key version and
  ADR 0001 describes rotation. Rotation has never been performed.

---

## Note on phase numbering

The master prompt's Phase 11 is this audit. The roadmap, renumbered during
Phase 10, lists Phase 11 as "production hardening and private-pilot release."
Both are real and distinct pieces of work, and this audit's findings are a large
part of that hardening phase's input.

Recommended: this audit becomes Phase 11; hardening and the pilot become
Phase 12. The roadmap has not been edited, because editing it is a change to the
plan rather than a finding, and this phase stops at the audit.
