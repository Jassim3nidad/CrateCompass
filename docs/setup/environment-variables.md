# Environment variables

Every variable the application reads, what it is for, and what happens when it
is wrong. The authority is `lib/validation/environment.ts` — a Zod schema that
runs at startup and **refuses to boot** on invalid configuration rather than
failing later in a way that looks like a bug.

**No real value appears in this document, in `.env.example`, or in any commit.**

---

## How validation behaves

- The schema is strict about shape and lenient about extras (`.passthrough()`),
  so platform-injected variables do not break the boot.
- Empty strings are treated as absent, so a blank line in a `.env` file does not
  masquerade as a configured value.
- Conditional requirements are enforced: setting `SPOTIFY_CLIENT_ID` makes the
  encryption key and redirect URI mandatory, and the AI provider you select
  makes only *its* credentials mandatory.

---

## Core

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `development` \| `test` \| `production`. Set by the framework and by Vercel. |
| `APP_ENV` | yes | `development` \| `preview` \| `production` \| `test`. Distinct from `NODE_ENV` because preview builds are production builds. |
| `LOG_LEVEL` | yes | `debug` \| `info` \| `warn` \| `error`. **Currently validated but not enforced** — see SEC-06 in the security audit. |
| `NEXT_PUBLIC_APP_URL` | yes | Absolute origin. Must be HTTPS, or an explicit loopback IP. `localhost` is rejected: Spotify requires `127.0.0.1`. |

## Supabase

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL. Reaches the browser. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | The `sb_publishable_…` key. Safe in the client; RLS is what protects data. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | The `sb_secret_…` key. **Server only.** Never expose it. |

> **Fetching these from the CLI:** `supabase projects api-keys` masks secret
> values with `·` characters by default. You must pass `--reveal`, or you will
> silently configure an unusable key — this happened during the Phase 12
> deployment and cost a debugging cycle.

`service_role` holds **no table grants** in this schema. Privileged work goes
through `security definer` functions granted to `service_role` alone. Do not
"fix" a permission error by adding table grants.

## Spotify

| Variable | Required | Notes |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | optional | Absent disables the integration cleanly; discovery still works. |
| `SPOTIFY_REDIRECT_URI` | with client id | Must match the dashboard exactly, including scheme, port and path. |
| `SPOTIFY_TOKEN_ENCRYPTION_KEY` | with client id | Base64 decoding to exactly 32 bytes. Generate: `openssl rand -base64 32`. |
| `SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION` | yes | Positive integer. Rotation mechanism — see ADR 0001. |

**`SPOTIFY_CLIENT_SECRET` is deliberately not in the schema.** ADR 0002 selects
Authorization Code with PKCE, under which no application code reads a secret,
and a compliance test asserts no module names that variable. It appears in
`.env.example` labelled unused, purely so reversing the decision is a one-line
change. Setting it does nothing.

**Rotating the encryption key** is not a matter of replacing the value. Stored
credentials are sealed with AES-256-GCM whose additional authenticated data
includes the key version; changing the key without incrementing the version and
providing the old key makes existing connections undecryptable. Listeners would
have to reconnect.

## MusicBrainz

| Variable | Required | Notes |
| --- | --- | --- |
| `MUSICBRAINZ_APP_NAME` | yes | Sent in the User-Agent. |
| `MUSICBRAINZ_APP_VERSION` | yes | Sent in the User-Agent. |
| `MUSICBRAINZ_CONTACT` | yes | A real contact. MusicBrainz throttles or blocks anonymous traffic. |

## Discovery provider

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCOVERY_PROVIDER` | yes | `listenbrainz` \| `lastfm`. Only ListenBrainz is implemented — ADR 0003. Selecting `lastfm` boots, then fails at the first discovery call and reports it in settings. |
| `LISTENBRAINZ_USER_TOKEN` | optional | Not required by the endpoints used. |
| `LISTENBRAINZ_SIMILARITY_ALGORITHM` | optional | Overrides the default algorithm. |

## AI provider

`AI_PROVIDER` selects one of `openai`, `anthropic`, `gemini`, `openrouter`.
**Only the selected provider's two variables are required**, so switching
provider is configuration rather than a deployment change.

| Provider | Variables |
| --- | --- |
| `openai` | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| `anthropic` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| `gemini` | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| `openrouter` | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |

Model names are never hard-coded in product logic.

## Declared but unused

| Variable | Status |
| --- | --- |
| `RATE_LIMIT_STORE_URL`, `RATE_LIMIT_STORE_TOKEN` | Validated, **read by no module**. There is no application-level rate limiting. Recorded as SEC-03. |

## Test-only

| Variable | Notes |
| --- | --- |
| `PROVIDER_FIXTURES` | `1` serves canned provider data. The schema **refuses to validate** this unless `APP_ENV=test`, so a deployment that sets it by accident fails to boot rather than serving invented artists. |

---

## Handling rules

1. Secrets live in the platform's environment store, never in the repository.
   `.env*` is gitignored except `.env.example`.
2. `.env.example` carries names and comments, never values.
3. Rotate anything that has been pasted into a chat, an issue, or a log.
4. Production and development should use separate credentials. **They currently
   do not for the AI provider** — the deployed build reuses the development
   Gemini key. Recorded as a known limitation in the release report.
