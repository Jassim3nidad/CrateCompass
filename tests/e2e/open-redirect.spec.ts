import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

/**
 * The post-authentication redirect cannot leave the origin.
 *
 * This exists because it did. `getSafeReturnPath` rejected a candidate starting
 * `//` but returned the *normalised* path without re-checking it, and
 * `/..//evil.com` normalises to `//evil.com`, which resolves off-site. A
 * listener who signed in on the real domain was handed to an external origin
 * (Phase 11, SEC-01).
 *
 * The unit suite covers the guard. This covers the thing that was actually
 * broken: the guard *composed with* the sign-in server action and Next's
 * redirect, which is where the protocol-relative path became a real navigation.
 * A unit test on the guard alone would have kept passing if a future caller
 * stopped using it.
 *
 * Off-origin requests are aborted rather than followed, so a regression is
 * recorded as an attempt instead of reaching a third-party server from CI.
 */

const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "redirect-regression-password-7714";

/** Every payload below normalises to `//example.com` inside the URL parser. */
const HOSTILE_RETURN_PATHS = [
  "/..//example.com",
  "/a/..//example.com",
  "/%2e%2e//example.com",
] as const;

let email = "";
let userId = "";

test.beforeAll(async () => {
  email = `redirect-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cratecompass.test`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(
      `Could not create the end-to-end account. Is \`supabase start\` running? ${error?.message ?? ""}`,
    );
  }

  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    userId = "";
  }
});

async function recordOffsiteAttempts(page: Page): Promise<readonly string[]> {
  const attempts: string[] = [];

  await page.route("**/*", async (route) => {
    const url = route.request().url();

    if (url.startsWith("http://127.0.0.1:3100") || url.startsWith("data:")) {
      await route.continue();
      return;
    }

    attempts.push(url);
    await route.abort();
  });

  return attempts;
}

for (const returnTo of HOSTILE_RETURN_PATHS) {
  test(`signing in with returnTo=${returnTo} stays on the origin`, async ({
    page,
  }) => {
    const offsite = await recordOffsiteAttempts(page);

    await page.goto(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();

    // The fallback, which is where a rejected candidate must land.
    await page.waitForURL("**/discover");

    expect(offsite, `attempted off-origin navigation for ${returnTo}`).toEqual(
      [],
    );
    expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:3100\//);
  });
}

test("an ordinary returnTo is still honoured", async ({ page }) => {
  // The guard must reject the hostile cases without breaking the feature it
  // exists to serve — otherwise the fix is indistinguishable from deleting it.
  await page.goto("/auth/sign-in?returnTo=%2Flibrary");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/library");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
