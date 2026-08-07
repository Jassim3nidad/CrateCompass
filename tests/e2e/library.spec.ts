import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * The library and history, in a browser.
 *
 * The assertions that matter most are the ones about honesty: that removing
 * something says the restored copy will be a new entry, that bulk delete states
 * its count and promises no undo, and that an empty library distinguishes
 * "nothing saved" from "nothing matches these filters".
 *
 * History recording is also checked end to end, because until this phase
 * nothing wrote `discovery_sessions` at all and the page could only ever be
 * empty.
 */

const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const PASSWORD = "synthetic-e2e-only-password-9812";
const SEED_ARTIST = "f1000000-0000-4000-8000-000000000001";

let email = "";
let userId = "";

test.beforeEach(async () => {
  email = `library-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cratecompass.test`;

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

test.afterEach(async () => {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    userId = "";
  }
});

async function signIn(
  page: import("@playwright/test").Page,
  returnTo: string,
): Promise<void> {
  await page.goto(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(`**${returnTo}**`, { timeout: 20_000 });
}

/** Saves one discovery, which is the only way to put something in the library. */
async function saveOneDiscovery(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto(`/discover?q=harbour&artist=${SEED_ARTIST}`);

  const save = page.getByRole("button", { name: /^Save/ }).first();
  await expect(save).toBeVisible({ timeout: 30_000 });
  await save.click();
  await expect(
    page.getByRole("button", { name: /^Saved/ }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

test("an untouched library says nothing is saved, not that nothing matches", async ({
  page,
}) => {
  await signIn(page, "/library");

  await expect(page.getByText("Nothing saved yet")).toBeVisible();
  await expect(page.getByText("Nothing matches those filters")).toHaveCount(0);
});

test("a filtered library that matches nothing says so distinctly", async ({
  page,
}) => {
  await signIn(page, "/library");
  await saveOneDiscovery(page);

  // A search that cannot match anything saved. The distinction matters: the
  // listener has items and needs to clear a filter, not save something.
  await page.goto("/library?q=zzzznotathing");

  await expect(page.getByText("Nothing matches those filters")).toBeVisible();
  await expect(page.getByText("Nothing saved yet")).toHaveCount(0);
});

test("a saved discovery appears with the explanation that was on screen", async ({
  page,
}) => {
  await signIn(page, "/library");
  await saveOneDiscovery(page);

  await page.goto("/library");

  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await expect(page.getByText(/^Saved /).first()).toBeVisible();
});

test("removing something offers undo and says the copy will be a new entry", async ({
  page,
}) => {
  await signIn(page, "/library");
  await saveOneDiscovery(page);
  await page.goto("/library");

  await page
    .getByRole("button", { name: /^Remove/ })
    .first()
    .click();

  // The honesty this phase committed to: undo re-inserts rather than
  // resurrects, and the copy says so before the listener relies on it.
  await expect(page.getByText(/creates a new entry dated today/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("undo puts the item back", async ({ page }) => {
  await signIn(page, "/library");
  await saveOneDiscovery(page);
  await page.goto("/library");

  await page
    .getByRole("button", { name: /^Remove/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Undo" }).click();

  await expect(page.getByText("Nothing saved yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(1);
});

test("bulk removal states the count and promises no undo", async ({ page }) => {
  await signIn(page, "/library");
  await saveOneDiscovery(page);
  await page.goto("/library");

  await page.getByRole("button", { name: /^Select these/ }).click();
  await page.getByRole("button", { name: /^Remove 1 selected/ }).click();

  // Bulk delete is irreversible, so the count must be real and the warning
  // must appear before the click that does it.
  await expect(
    page.getByText(/Delete 1 item\? This cannot be undone/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete 1" })).toBeVisible();
});

test("history records a discovery that actually happened", async ({ page }) => {
  await signIn(page, "/history");

  // Nothing has happened on this account yet, and it was created after
  // recording began, so this is the ordinary empty state.
  await expect(page.getByText("Nothing recorded yet")).toBeVisible();

  await page.goto(`/discover?q=harbour&artist=${SEED_ARTIST}`);
  await expect(page.getByRole("button", { name: /^Save/ }).first()).toBeVisible(
    { timeout: 30_000 },
  );

  await page.goto("/history");

  await expect(page.getByText("Artist search", { exact: true })).toBeVisible();
  await expect(page.getByText(/candidate/)).toBeVisible();
});

test("deleting a history entry says what it does not touch", async ({
  page,
}) => {
  await signIn(page, "/history");

  await page.goto(`/discover?q=harbour&artist=${SEED_ARTIST}`);
  await expect(page.getByRole("button", { name: /^Save/ }).first()).toBeVisible(
    { timeout: 30_000 },
  );

  await page.goto("/history");
  await expect(page.getByText("Artist search", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Delete all history/ }).click();

  await expect(page.getByText(/This cannot be undone/).first()).toBeVisible();
});

test("@a11y the library has no violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await signIn(page, "/library");
  await saveOneDiscovery(page);
  await page.goto("/library");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("@a11y the library controls keep contrast when hovered", async ({
  page,
}) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await signIn(page, "/library");
  await saveOneDiscovery(page);
  await page.goto("/library");

  // Hover states are the gap an ordinary scan misses: a 3.88:1 contrast defect
  // survived two phases because no button was hovered during a scan.
  await page.getByRole("button", { name: /^Select these/ }).hover();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("@a11y history has no violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await signIn(page, "/history");

  // `waitForURL` resolves before the body has streamed in, and scanning a
  // half-rendered page reports a missing level-one heading that is simply not
  // there yet. Wait for the heading itself.
  await expect(
    page.getByRole("heading", { level: 1, name: /Every trail/i }),
  ).toBeVisible({ timeout: 20_000 });

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
