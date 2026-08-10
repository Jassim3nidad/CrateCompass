import { defineConfig, devices } from "@playwright/test";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const port = 3100;
const continuousIntegrationSettings = process.env.CI
  ? { forbidOnly: true, retries: 2, workers: 1 }
  : { forbidOnly: false, retries: 0 };

/**
 * The end-to-end suite runs against the **local** Supabase stack, not the
 * linked cloud project.
 *
 * Two reasons. Tests that create and delete accounts should not be doing that
 * in a shared project, and the authenticated mood journey needs a real signed-in
 * session — which means a real account, created and torn down per run.
 *
 * These are the standard local development keys: identical on every machine,
 * published in Supabase's own documentation, and worthless outside 127.0.0.1.
 * `supabase start` must be running; the suite fails loudly rather than skipping
 * if it is not.
 */
const localSupabase = {
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.LOCAL_SUPABASE_ANON_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
} as const;

// The spec process needs the same database the app is using. Without this,
// tests that create an account through the admin API would create it in the
// linked cloud project while the application authenticates against the local
// stack, and every sign-in would fail for a reason that looks like a bug.
Object.assign(process.env, localSupabase);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  ...continuousIntegrationSettings,
  /**
   * Twenty seconds for every assertion, rather than five by default with a
   * handful of per-assertion overrides.
   *
   * Roadmap follow-up "e2e sign-in assertions are timing-sensitive": three
   * specs asserted a post-sign-in navigation on the five-second default while
   * the rest of the suite passed 20_000 by hand. Sign-in through `next dev`
   * takes seven to thirteen seconds on a loaded machine, so which specs were
   * marginal depended on which had remembered the override. With `retries: 0`
   * locally and `retries: 2` in CI, a marginal assertion fails on a developer
   * machine and passes in CI — the wrong way round.
   *
   * Raising the floor removes the class of defect instead of the symptom. It
   * cannot mask a real regression: a genuinely broken navigation never
   * arrives, so it still fails, only later.
   */
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    env: {
      ...process.env,
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
      // Provider calls happen server-side, so Playwright cannot intercept
      // them. The fixture providers are the substitute, and the environment
      // schema refuses to validate this flag unless APP_ENV is "test" — so
      // both must be set together and neither can leak into a real
      // deployment.
      APP_ENV: "test",
      PROVIDER_FIXTURES: "1",
      ...localSupabase,
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
