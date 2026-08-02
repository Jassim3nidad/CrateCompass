# CrateCompass

CrateCompass is an AI-assisted music-discovery application focused on sourced artist relationships, mood interpretation, canonical discographies, and personal discovery management. Spotify is an optional export destination and its content is never sent to AI.

## Phase 1 foundation

This repository currently contains the responsive Next.js App Router shell, strict TypeScript configuration, Tailwind/shadcn-compatible design tokens, accessible route shells, environment validation, redacted structured logging, and the automated quality toolchain. Authentication, databases, and provider integrations are intentionally not implemented yet.

## Local setup

Requirements: Node.js 24 and npm 11 (the currently verified workspace versions).

```bash
npm install
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

Open <http://127.0.0.1:3000>. Local URLs intentionally use an explicit loopback IP rather than `localhost` to match the planned Spotify redirect policy.

## Quality commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run test:a11y
npm run build
```

Install the Playwright browser once with `npx playwright install chromium` before the browser suites.

## Environment behavior

`.env.example` is the complete contract. Provider secrets are optional until their approved phases, while application identity, URLs, logging, provider selections, and version metadata are validated through Zod. `validateServerEnvironment()` throws one clear aggregated error when required values are absent or invalid.

Never commit `.env.local` or real credentials. Only variables prefixed with `NEXT_PUBLIC_` may be considered for browser exposure, and that prefix does not make a value safe automatically.

## Architecture and compliance

Planning documents live under `docs/`. Begin with:

- `docs/product/product-requirements.md`
- `docs/architecture/system-architecture.md`
- `docs/architecture/provider-boundaries.md`
- `docs/security/threat-model.md`
- `docs/compliance/spotify-compliance.md`

Phase 2 must be approved separately before Supabase authentication or database work begins.
