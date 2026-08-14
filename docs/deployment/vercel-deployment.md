# Vercel deployment

The procedure actually used to deploy https://cratecompass.vercel.app, including
the two things that went wrong.

---

## Project

| | |
| --- | --- |
| Project | `cratecompass` (`prj_U09QFRb1N7zjQLC5N3ir9tGSIyUs`) |
| Production URL | https://cratecompass.vercel.app |
| Framework preset | Next.js (auto-detected) |
| Build command | `npm run build` (`next build --webpack`) |
| Node version | 24.x |
| Region | Vercel default |

## 1. Link

```bash
npx vercel link --yes --project cratecompass
```

Creates the project if it does not exist and connects the GitHub repository. It
writes `.vercel/` and appends `VERCEL_OIDC_TOKEN` to `.env.local`; both are
gitignored.

**Authentication:** prefer an interactive `vercel login`, which stores the
session locally. Do not paste an access token into a chat, an issue, or a
script — a Vercel token is account-wide and can deploy, read environment
variables, and delete projects.

## 2. Environment variables

Set every variable from
[`../setup/environment-variables.md`](../setup/environment-variables.md) for the
Production environment. Piping avoids the value reaching a shell history or a
terminal:

```bash
printf '%s' "$VALUE" | npx vercel env add VARIABLE_NAME production --force
```

Production values that differ from development:

| Variable | Production value |
| --- | --- |
| `APP_ENV` | `production` |
| `NEXT_PUBLIC_APP_URL` | `https://cratecompass.vercel.app` |
| `SPOTIFY_REDIRECT_URI` | `https://cratecompass.vercel.app/api/integrations/spotify/callback` |

`PROVIDER_FIXTURES` must be **absent**. The environment schema refuses to boot
if it is set outside a test environment, which is the intended failure mode.

> ### Two failures worth repeating
>
> **The Supabase CLI masks secret keys.** `supabase projects api-keys` prints
> `sb_secret_XXXXX··························` unless you pass `--reveal`. That
> masked string was configured as `SUPABASE_SERVICE_ROLE_KEY` on the first
> deployment and every privileged operation failed. Always `--reveal`, and
> always assert the value matches `^sb_secret_[A-Za-z0-9_-]+$` before setting it.
>
> **`NEXT_PUBLIC_*` values are inlined at build time.** Correcting one in the
> dashboard changes nothing until you redeploy. Fixing the publishable key
> required a fresh deployment, not a restart.

## 3. Deploy

```bash
npx vercel --prod --yes
```

The CLI reports the immutable deployment URL and then the alias. The alias is
what users visit.

## 4. Verify

Do not trust a green build. The environment schema validates at **runtime**, so
a misconfigured variable produces a successful build and a broken site.

```bash
for p in / /discover /mood /auth/sign-in /artists/not-an-mbid; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' "https://cratecompass.vercel.app$p")  $p"
done

# Protected routes must bounce to sign-in carrying returnTo
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://cratecompass.vercel.app/library

# Security headers
curl -sI https://cratecompass.vercel.app/ | grep -iE 'x-frame|x-content-type|referrer|permissions|strict-transport'
```

Then exercise a real signed-in journey. The Phase 12 verification created a
throwaway account, ran discovery → explanation → save → library → discography →
Q&A → mood → deletion, and removed the account afterwards. Results are in the
release report.

**A trap worth avoiding when scripting verification:** Playwright's
`locator.isVisible({ timeout })` does **not** retry — it answers immediately and
ignores the timeout. Using it reported two working features as broken and sent
the Phase 12 deployment on a false root-cause hunt. Use
`locator.waitFor({ state: "visible", timeout })`, or `expect(locator).toBeVisible()`.

## 5. Headers

`next.config.ts` sets `Referrer-Policy`, `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Permissions-Policy`, and disables `X-Powered-By`.
Vercel adds `Strict-Transport-Security` on its own domains — confirmed present
in production, and something to set explicitly if you move to a custom domain.

**There is no Content-Security-Policy.** Recorded as SEC-02.

---

## Rollback

Vercel deployments are immutable, so rollback is re-aliasing, not rebuilding.

```bash
npx vercel ls cratecompass                       # find the last good deployment
npx vercel promote <deployment-url>              # alias production to it
```

Or use **Instant Rollback** in the dashboard under Deployments.

**Rollback does not revert the database.** Migrations are forward-only, and the
five applied in Phase 12 are additive (new tables, widened check constraints,
replaced indexes). Rolling the application back to a build that predates them is
safe because the older code simply does not use the new objects. Rolling
*forward* past a destructive migration would not be, so keep them additive.

**If a rollback is caused by bad configuration rather than bad code**, fix the
variable and redeploy instead — and remember that `NEXT_PUBLIC_*` needs a new
build to take effect.

---

## Not configured

Stated so nobody assumes otherwise:

- **No CI/CD gates.** The GitHub repository is connected, so pushes will
  deploy, but no workflow runs lint, type-check, tests, or the compliance suite
  first. Recorded as TEST-05.
- **No error reporting** (Sentry or equivalent). Runtime errors reach Vercel's
  log stream and nowhere else.
- **No uptime monitoring or alerting.**
- **No dedicated health-check endpoint.**
- **No rate limiting** beyond Supabase's own auth limits.
