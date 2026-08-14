# CrateCompass — case study

**A music discovery application built around a constraint: never claim more than
the data supports.**

Live: https://cratecompass.vercel.app · Twelve phases · Next.js, Supabase, four
external providers

---

## The problem

Recommendation systems ask you to trust them. You get a list, and no way to ask
why. When they are wrong, you cannot tell whether the model misread you or the
data was thin.

CrateCompass takes the opposite position. Every relationship names the provider
that reported it. Every factual answer cites its records. When the data does not
support an answer, the product says so instead of producing a plausible
sentence.

That sounds like a UX choice. It is mostly an engineering one, and it is where
the interesting problems were.

---

## The hard constraint

**No Spotify content may reach an AI provider.** That is a term of Spotify's
developer agreement, and it cuts directly across a product whose central feature
is explaining music with a language model.

A comment saying "don't do this" is not a control. Four independent mechanisms
enforce it, and any one would catch a mistake:

1. **Types.** Spotify values are branded (`SpotifyResourceId`, `SpotifyUri`) and
   are not assignable to AI input types. A compile-time test asserts the
   non-assignability.
2. **A runtime gateway.** Every call passes `buildAiInput`: a strict schema that
   rejects unknown keys, a provenance allowlist on which Spotify never appears,
   a recursive scan for Spotify hosts, URIs and credential-shaped strings at any
   depth, and size caps. It returns the *parsed clone*, so the payload on the
   wire cannot be the caller's original object with extra properties attached.
3. **The module graph.** ESLint rules keep the trees disjoint in both
   directions.
4. **A repository scan.** A compliance test reads the source and asserts all of
   the above on every run.

The design principle: make the mistake *structurally impossible* rather than
merely forbidden. Spotify ended up with exactly four permitted endpoints and two
scopes — no read scopes at all, so the application cannot reach listening
history even if a future code path tried.

---

## Three problems worth describing

### The bug that hid behind Portishead

MusicBrainz's `inc=release-groups` lookup returns **at most 25 release groups,
silently**. No flag, no count, no indication more exist.

It survived two phases because the test artist was Portishead — who has exactly
25. Nirvana has 573.

The fix escalates a result of exactly 25 to paginated retrieval, bounded at ten
pages because the "Various Artists" entity holds 288,991 release groups, roughly
45 minutes at the one-request-per-second rate limit. When the bound engages,
`retrievalComplete` goes false, and that flag is load-bearing: the Q&A layer
refuses to answer counting questions when it is set, because a count over a
truncated list is a confident wrong answer.

**The lesson:** a fixture that happens to sit exactly on a boundary will hide
that boundary indefinitely.

### An open redirect that a passing test suite concealed

The Phase 11 audit found a post-authentication open redirect. The guard rejected
any path starting `//`, then normalised the survivor through the URL parser and
returned the result.

Normalisation *produces* what the input check rejected: `/..//evil.com`
normalises to `//evil.com`, which `new URL(path, base)` resolves to
`http://evil.com/`. Reachable through `?returnTo=` on sign-in. I demonstrated it
end to end — genuine authentication on the genuine domain, then a navigation to
an external origin. In an OAuth application, a trusted-origin redirector is a
standard step in authorization-code interception.

The unit test had passed the whole time. It asserted `//example.com`,
`https://…`, `javascript:` and `null` — the inputs someone had thought of.

The fix asserts the *post-condition* rather than trusting the pre-condition. The
regression test now checks the **resolved absolute URL**, because the guard is
only safe in combination with how its caller uses the result.

**The lesson:** test the property, not the examples. A green suite is evidence
about what you thought to check.

### A verification script that invented a production outage

During deployment, verification reported that explanation generation and saving
were broken in production. The logs showed foreign-key violations. I spent a
diagnostic cycle on schema archaeology — checking every FK, confirming the JWT
issuer, calling the RPC directly, verifying the profile trigger.

The database was fine. My script used Playwright's
`locator.isVisible({ timeout })`, which **does not retry** — it answers
immediately and ignores the timeout. Everything still loading read as broken.
The FK errors were real but stale, from a window when a masked service-role key
was configured.

Triggering one explanation manually showed a fully rendered panel with complete
evidence. Corrected waits: 16 passed, 0 failed.

**Two lessons.** A tool that silently means something adjacent to what you
assumed will cost you hours. And when the evidence is contradictory — Q&A
working while explanation failed, same user, seconds apart — the contradiction
is the signal. I should have distrusted the harness sooner.

---

## Engineering decisions that paid off

**Ports at every provider boundary.** Each has one selection seam. When
ListenBrainz's popularity API turned out to be server-side disabled, track
selection degraded to a documented heuristic behind an unchanged port.

**Deterministic logic separated from generated language.** Similarity strength,
ranking and evidence assembly are pure functions. The model only *describes*
what the deterministic layer produced, and its output is verified against the
evidence supplied — a citation naming something not provided discards the whole
answer in favour of a template.

**Least privilege in the database.** `service_role` holds no table grants at
all. Privileged work goes through `security definer` functions granted to it
alone. A permission error is usually the design working.

**Deletion with no escape hatch.** No soft-delete flag, no holding table. Undo
works by handing the removed row to the browser and re-inserting it; the
restored row is a new row dated today, and the interface says so.

**Honest empty states.** An account older than the history feature is told
history began on a date. A new account is told nothing has happened yet.
Different facts, different sentences.

---

## Verification

| Gate | Result |
| --- | --- |
| Unit, integration, contract, compliance | 610 passed |
| End-to-end (Chromium + mobile) | 201 passed |
| Accessibility (axe) | 54 passed |
| RLS (pgTAP) | 140 assertions |
| Responsive | 63 overflow cases, 7 widths × 9 routes |
| Lighthouse (production) | Accessibility 100, Best Practices 100, SEO 100, CLS 0 |

Two opt-in suites run against real Postgres and real providers, because mocks
cannot prove the provider factories or RLS actually work.

---

## What I would do differently

**CI from phase one.** There is still none. Every gate is run by hand, including
the compliance suite that enforces the product's defining constraint. It is the
single largest gap.

**Publish the policy earlier.** The privacy policy is a prerequisite for a
Spotify application, and it blocked release at the end rather than being drafted
alongside the data model it describes.

**Separate production credentials from the start.** The deployed build reuses a
development AI key because production-specific credentials were never issued.

**Question the harness sooner.** Two of the three debugging stories above were
tooling, not product.

---

## Honest status

Deployed and working for everything except Spotify, whose production redirect
URI is not yet registered — so connection, playlist creation and disconnect are
**unverified in production** and reported as blocked rather than passed.

The Phase 11 audit's open findings are tracked in
[`docs/audits/release-readiness.md`](../audits/release-readiness.md): no CSP, no
rate limiting, an audit-trail table nothing writes to, and injection
neutralisation applied to one of two model-facing paths.

None of that is hidden in a summary, which is rather the point of the project.
