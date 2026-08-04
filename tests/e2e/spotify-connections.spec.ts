import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * `/settings/connections` states.
 *
 * No real Spotify account is involved: the page is exercised in its
 * not-connected state and every callback outcome is driven through the query
 * string the OAuth route redirects with, so the copy for each failure mode is
 * covered without touching Spotify.
 */

const password = "Phase3Secure123!";
const email = `phase3-${Date.now()}-${Math.random().toString(16).slice(2)}@cratecompass.test`;
let userId: string | undefined;
let admin: SupabaseClient;

test.setTimeout(60_000);
test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/settings/connections");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/settings\/connections$/);

  // The URL updates before the streamed content paints, so waiting on the
  // heading is what actually guarantees the page is ready to assert against.
  await expect(
    page.getByRole("heading", { level: 1, name: /Spotify is optional/i }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase E2E environment is not configured.");
  }

  admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Phase Three Listener" },
  });
  if (error) throw error;
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("connections is protected and renders the not-connected state", async ({
  page,
}) => {
  await page.goto("/settings/connections");
  await expect(page).toHaveURL(
    /\/auth\/sign-in\?returnTo=%2Fsettings%2Fconnections/,
  );

  await signIn(page);

  await expect(
    page.getByRole("heading", { level: 1, name: /Spotify is optional/i }),
  ).toBeVisible();
  await expect(page.getByText("Not connected")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Spotify" }),
  ).toBeEnabled();

  // No disconnect action exists before a connection does.
  await expect(
    page.getByRole("button", { name: "Disconnect Spotify" }),
  ).toHaveCount(0);
});

test("the page states the minimum scope and the AI prohibition", async ({
  page,
}) => {
  await signIn(page);

  await expect(page.getByText("playlist-modify-private").first()).toBeVisible();
  await expect(
    page.getByText(/Spotify data is never sent to an AI provider/i),
  ).toBeVisible();
  await expect(
    page.getByText(/does not request access to your listening history/i),
  ).toBeVisible();
  await expect(page.getByText(/expire after six months/i)).toBeVisible();
});

const callbackOutcomes = [
  { status: "denied", copy: /authorization was declined/i },
  { status: "invalid-state", copy: /expired, already used/i },
  { status: "session-mismatch", copy: /different CrateCompass session/i },
  { status: "insufficient-scope", copy: /did not grant the private-playlist/i },
  { status: "not-allowlisted", copy: /not on the pilot allowlist/i },
  { status: "already-linked", copy: /already linked to a different/i },
  { status: "quota-exceeded", copy: /rate limiting or has exhausted/i },
  { status: "unavailable", copy: /did not respond/i },
  { status: "failed", copy: /could not be completed/i },
] as const;

for (const outcome of callbackOutcomes) {
  test(`renders the ${outcome.status} callback outcome as an alert`, async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`/settings/connections?spotify=${outcome.status}`);

    await expect(page.getByRole("alert")).toContainText(outcome.copy);
    await expect(
      page.getByRole("heading", { level: 1, name: /Spotify is optional/i }),
    ).toBeVisible();
  });
}

test("renders a successful connection outcome as a status, not an alert", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/connections?spotify=connected");

  await expect(page.getByRole("status")).toContainText(/Spotify is connected/i);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("ignores an unrecognised callback status rather than reflecting it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/connections?spotify=%3Cimg%20src%3Dx%3E");

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("@a11y connections has no automatically detectable violations", async ({
  page,
}) => {
  await signIn(page);
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});
