# Local development

From a clean checkout to a running application with a real database.

---

## Prerequisites

- **Node 24.x** and **npm 11.x** (pinned in `package.json` `engines`, and in `.nvmrc`)
- **Docker or Podman**, for the local Supabase stack
- **Supabase CLI**, installed as a devDependency — use `npx supabase`

---

## 1. Install and configure

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Every variable is documented in
[`environment-variables.md`](environment-variables.md). The minimum for a
useful local run:

- `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000` — **not** `localhost`
- The three Supabase values, from `npx supabase start` output
- The three `MUSICBRAINZ_*` values, with a real contact address
- `DISCOVERY_PROVIDER=listenbrainz`
- `AI_PROVIDER` plus that provider's key and model
- A generated `SPOTIFY_TOKEN_ENCRYPTION_KEY` if you set a `SPOTIFY_CLIENT_ID`

```bash
openssl rand -base64 32   # SPOTIFY_TOKEN_ENCRYPTION_KEY
```

Spotify is optional. Leave `SPOTIFY_CLIENT_ID` empty and everything except
connection and playlist creation still works.

## 2. Start the database

```bash
npx supabase start
npm run db:reset      # applies all migrations from empty
```

`npm run db:reset` is the repeatable path and the one CI-equivalent checks use.
It proves the migration chain applies from nothing, which is a different
guarantee from "the database currently looks right".

## 3. Run

```bash
npm run dev           # http://127.0.0.1:3000
```

Use `127.0.0.1`, not `localhost`. Spotify's redirect rules require the explicit
loopback IP, and the environment schema rejects `localhost` to stop the two
drifting apart.

---

## Verification

```bash
npm run check         # format:check, lint, typecheck, unit tests
npm run build

npx playwright test --grep-invert @a11y     # end-to-end
npx playwright test --grep @a11y            # accessibility

npm run db:reset && npm run db:test && npm run db:lint
```

Two opt-in suites are skipped by default so `npm test` stays offline:

```bash
LIVE_DATABASE=1 npx vitest run tests/live                        # real Postgres, two signed-in users
LIVE_PROVIDERS=1 npx vitest run tests/live/providers-live.test.ts # real MusicBrainz/ListenBrainz/AI
```

They exist because mocks cannot prove the provider factories or RLS actually
work.

> `npm run format:check | tail` masks the exit code. Check `$?` directly.

### How the end-to-end suite avoids live providers

Provider calls happen server-side, so Playwright cannot intercept them. Fixture
implementations are selected by four factories, all gated on
`APP_ENV=test` **and** `PROVIDER_FIXTURES=1` together. `playwright.config.ts`
sets both. The fixture AI provider still goes through `buildAiInput`, so the
compliance boundary is exercised exactly as in production.

The e2e suite requires a running local Supabase and creates and deletes accounts
per test. It fails loudly rather than skipping if the database is absent.

---

## Running on rootless Podman

Docker Desktop needs administrator rights, which were not available on the
development machine, so the stack runs on rootless Podman. Skip this section if
Docker works for you.

```bash
podman machine start
podman machine ssh "systemd-run --user --unit=podman-tcp --collect podman system service --time=0 tcp://127.0.0.1:2375"
export DOCKER_HOST=tcp://127.0.0.1:2375
```

Then start Supabase with the services that fail on Windows paths excluded:

```bash
npx supabase start -x edge-runtime,studio,imgproxy,logflare,vector,mailpit,realtime,storage-api,supavisor
```

Add Podman's bin directory to `PATH`
(`%LOCALAPPDATA%\Programs\podman\podman-<version>\usr\bin`).

**Known quirks, all encountered and worked around:**

| Symptom | Cause and fix |
| --- | --- |
| `win-sshproxy.exe failed to start` | No `docker_engine` named pipe. The loopback TCP socket above replaces it. Harmless. |
| Containers refuse to start | WSL2 has no nftables. Set netavark's firewall driver to `none` in the machine's `containers.conf`. |
| `volume already exists` on start | A previous stack was not stopped cleanly. `npx supabase stop --no-backup`, then `podman volume rm -f supabase_db_<project> supabase_edge_runtime_<project>`. |
| Everything unreachable after a reboot | The machine stops and the TCP unit is transient. Re-run both commands above. |

`supabase gen types --local` omits the `__InternalSupabase` block. It is
preserved by hand in `types/database.ts` — re-add it after every
`npm run db:types`.

---

## Layout

```
app/          routes: /, /discover, /mood, /artists/[artistId], /library,
              /history, /settings, /auth/*
components/   layout primitives and the UI kit
features/     product logic by domain: discovery, mood, playlists, discography,
              library, history, spotify, auth
lib/
  ai/         port, adapters, gateway, schemas, limits, fallbacks
  providers/  musicbrainz, discovery (listenbrainz), spotify, fixtures
  security/   token encryption, encryption keys, safe redirects
  supabase/   server, client, admin, proxy
supabase/     migrations and pgTAP tests
tests/        unit, integration, contract, compliance, e2e, live
docs/         architecture (+ADRs), audits, compliance, deployment, integrations,
              product, project, security, setup
```

**Two rules worth knowing before you edit:**

1. Provider response types stay inside provider modules. Everything crossing a
   boundary is a normalised, application-owned domain type.
2. The Spotify/AI separation is enforced by ESLint `no-restricted-imports` in
   both directions. If an import is refused, that is the design working — route
   through a domain type instead.
