# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is phase-based; this project has not yet cut a 1.0.

---

## [0.1.0] — 2026-08-14

First deployment. https://cratecompass.vercel.app

### Added — this release

- Production deployment on Vercel, with the Supabase production database brought
  from five migrations behind to fully current.
- Fifteen documents: setup, deployment, per-integration references, privacy and
  terms drafts, user guide, and a case study.
- `app/icon.svg`, giving the application a browser-tab identity.

### Fixed — this release

- **SEC-01, post-authentication open redirect (High).** `getSafeReturnPath`
  rejected input starting `//` but returned the _normalised_ path without
  re-checking it, and `/..//evil.com` normalises to `//evil.com`, which resolves
  off-origin. Reachable through `?returnTo=` on sign-in and sign-up, and
  demonstrated end to end before the fix. The guard now asserts its
  post-condition. Covered by 25 unit cases and 4 end-to-end cases.

### Known limitations

- Spotify OAuth, playlist creation and disconnect are **unverified in
  production**: the production redirect URI is not registered in the Spotify
  dashboard.
- No privacy policy or terms are published; only drafts exist (SPC-01).
- No CI. Every gate is run by hand (TEST-05).
- No CSP, no application-level rate limiting, no error reporting, no uptime
  monitoring.
- The deployed build reuses the development AI provider key.

---

## Phase history

### Phase 11 — Security, compliance and quality audit

Five audit documents covering security, Spotify compliance, accessibility,
testing and release readiness. 27 findings: 0 critical, 4 high, 9 medium, 8 low,
6 informational. Found SEC-01 above, plus the absent privacy policy, the absent
CI, and a `security_events` table that nothing writes to.

### Phase 10 — UI/UX polish and motion

Completed the token set — including `--accent-soft`, which was referenced by
settings and never defined, so the declaration was invalid and the link
inherited body colour. Consolidated fourteen duplicated focus-ring strings into
one `.focus-ring` class, switching from ring-plus-offset to `outline`, which
also fixed a dark seam wherever a focusable element sat on a lighter surface.
Added motion on six surfaces, declared _inside_
`prefers-reduced-motion: no-preference` so a reduced-motion user gets no
animation rather than a compressed one. Replaced the `<details>` mobile menu
with a real disclosure. Removed five phase notices that still told listeners a
shipped feature was coming. Derived the Q&A suggested questions from the
retrieved timeline.

### Phase 9 — Library, history and data rights

Library with search, filters, tags, notes and undo. History — and the defect it
existed to fix: nothing wrote `discovery_sessions`, so the page was permanently
empty with no sign of it. Genuine deletion, with no soft-delete flag, and
`export_user_data` enumerating every table with a foreign key to `auth.users`.

### Phase 8 — Discography explorer and Q&A

Release-group timeline with date precision. Grounded Q&A with citation
verification, and "not enough context" as a first-class success. Input
neutralisation for community-edited titles.

### Phase 7 — Mood discovery and playlist creation

Natural-language mood parsing, human seed confirmation, candidate review, and
idempotent Spotify playlist creation after explicit approval.

### Phase 6 — Artist discovery

Canonical artist selection, relationship results with provider-attributed
evidence, and explanations verified against the evidence supplied.

### Phase 5 — AI abstraction and safety boundary

Provider-neutral interface with four adapters. `buildAiInput`: strict schema,
provenance allowlist, recursive Spotify scan, size caps. Postgres-enforced usage
limits that fail closed.

### Phase 4 — Music metadata and discovery providers

MusicBrainz and ListenBrainz adapters, normalised domain types with provenance,
global one-request-per-second pacing. Fixed a silent 25-item cap on release-group
retrieval that had hidden for two phases because Portishead has exactly 25.

### Phase 3 — Spotify connected account

Authorization Code with PKCE, digest-only state storage, single-use atomic
transaction claim, AES-256-GCM token encryption bound to purpose, subject, user
and key version.

### Phase 2 — Authentication and database

Supabase Auth, the full schema, RLS on every table, owner-immutability triggers,
and account deletion.

### Phase 1 — Foundation

Next.js App Router, strict TypeScript, Tailwind, the test harness, and the
original dark-neutral token set.

### Phase 0 — Discovery and planning

Requirements, architecture, provider boundaries, threat model, and the ADRs
selecting PKCE, ListenBrainz, and the AI provider stack.
