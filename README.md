# CrateCompass

**Discovery with a paper trail.** Trace how one artist connects to another,
translate a mood into a listening direction, read a discography, and keep the
finds worth returning to — with every claim attributed to the provider that
made it.

**Live:** https://cratecompass.vercel.app

---

## What it is

CrateCompass is a music discovery application built around one idea: a
recommendation you cannot interrogate is not much of a recommendation. Every
relationship it shows names the provider that reported it, every factual answer
cites the records it came from, and when the data does not support an answer it
says so instead of inventing one.

It is deliberately not a streaming client. Spotify is an optional destination —
a place to open an artist or receive a playlist you approved — never the source
of what gets recommended.

### What it does

| Feature             | How                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Similar artists     | ListenBrainz similarity, reconciled to canonical MusicBrainz identities                           |
| Why this match      | Evidence assembled from providers, then explained by a model that must cite the evidence it used  |
| Mood → playlist     | Natural language parsed into reviewable criteria; you confirm the seeds before anything is built  |
| Discography         | Full release-group timeline from MusicBrainz, with type and date precision                        |
| Discography Q&A     | Grounded answers with citations, and an honest refusal when the records do not say                |
| Library and history | Saved discoveries keep the explanation that convinced you; history records what actually happened |
| Data rights         | Disconnect Spotify, export your data, delete your account and everything attached to it           |

---

## The constraint that shapes everything

**No Spotify content ever reaches an AI provider.** Not artist metadata, not
track data, not images, not audio features, not listening history.

This is enforced in four independent ways, any one of which would catch a
mistake:

1. **Types.** Spotify values are branded (`SpotifyResourceId`, `SpotifyUri`) and
   are not assignable to AI input types.
2. **A runtime gateway.** Every AI call goes through `buildAiInput`: strict
   schema parse rejecting unknown keys, a provenance allowlist that never
   contains Spotify, a recursive scan for Spotify hosts, URIs and credentials,
   and size caps.
3. **The module graph.** ESLint rules keep the trees disjoint in both
   directions — AI modules cannot import Spotify adapters, and Spotify or
   playlist modules cannot import AI.
4. **A repository scan.** A compliance test reads the source tree and asserts
   all of the above on every run.

See [`docs/architecture/provider-boundaries.md`](docs/architecture/provider-boundaries.md).

---

## Stack

Next.js App Router · React 19 · TypeScript (strict, `exactOptionalPropertyTypes`)
· Tailwind CSS v4 · Supabase (Postgres, Auth, RLS) · Vercel

Providers: MusicBrainz (identity, discography) · ListenBrainz (similarity, tags)
· Spotify (links and playlist creation only) · a configurable AI provider
(OpenAI, Anthropic, Gemini, or OpenRouter).

---

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Full walkthrough, including the local database:
[`docs/setup/local-development.md`](docs/setup/local-development.md).
Every variable is described in
[`docs/setup/environment-variables.md`](docs/setup/environment-variables.md).

## Verification

```bash
npm run check          # format, lint, typecheck, unit tests
npm run build
npx playwright test --grep-invert @a11y
npx playwright test --grep @a11y
npm run db:reset && npm run db:test && npm run db:lint
```

Current state: 610 unit/integration/contract/compliance tests, 201 end-to-end,
54 accessibility, 140 pgTAP assertions. Lighthouse on production scores 100 for
accessibility, best practices and SEO.

---

## Documentation

| Area                   | Document                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Local setup            | [`docs/setup/local-development.md`](docs/setup/local-development.md)                 |
| Environment            | [`docs/setup/environment-variables.md`](docs/setup/environment-variables.md)         |
| Deploying the app      | [`docs/deployment/vercel-deployment.md`](docs/deployment/vercel-deployment.md)       |
| Deploying the database | [`docs/deployment/supabase-deployment.md`](docs/deployment/supabase-deployment.md)   |
| Spotify integration    | [`docs/integrations/spotify.md`](docs/integrations/spotify.md)                       |
| MusicBrainz            | [`docs/integrations/musicbrainz.md`](docs/integrations/musicbrainz.md)               |
| Discovery provider     | [`docs/integrations/discovery-provider.md`](docs/integrations/discovery-provider.md) |
| AI providers           | [`docs/integrations/ai-providers.md`](docs/integrations/ai-providers.md)             |
| Architecture           | [`docs/architecture/`](docs/architecture/) (+ 5 ADRs)                                |
| Security audit         | [`docs/audits/security-audit.md`](docs/audits/security-audit.md)                     |
| Design system          | [`docs/product/phase-10-design-system.md`](docs/product/phase-10-design-system.md)   |
| User guide             | [`docs/product/user-guide.md`](docs/product/user-guide.md)                           |
| Case study             | [`docs/project/portfolio-case-study.md`](docs/project/portfolio-case-study.md)       |

## Status

Deployed and working, with three caveats worth stating plainly:

- **Spotify flows are unverified in production.** The production redirect URI is
  not yet registered in the Spotify dashboard, so connecting an account and
  creating a playlist cannot be exercised on the live site.
- **No continuous integration.** Every gate above is run by hand.
- **Open findings** from the Phase 11 audit are listed in
  [`docs/audits/release-readiness.md`](docs/audits/release-readiness.md).

## Licence and attribution

Music metadata from [MusicBrainz](https://musicbrainz.org) and
[ListenBrainz](https://listenbrainz.org), used under their terms and credited in
the interface beside the data they supply. Spotify is a registered trademark of
Spotify AB; this project is not affiliated with or endorsed by Spotify.
