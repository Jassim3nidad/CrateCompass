import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const password = "Phase2Secure123!";
const email = `phase2-${Date.now()}-${Math.random().toString(16).slice(2)}@cratecompass.test`;
let userId: string | undefined;
let admin: SupabaseClient;

test.setTimeout(60_000);
test.describe.configure({ mode: "serial" });

async function signOut(page: Page, projectName: string) {
  if (projectName.includes("mobile")) {
    // By role and name rather than by tag. This was `header details summary`
    // and broke the moment the menu stopped being a `<details>` in Phase 10 —
    // a test asserting the markup it happened to find rather than the control
    // a listener uses.
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }

  await page.getByRole("button", { name: "Sign out" }).click();
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
    user_metadata: { display_name: "Phase Two Listener" },
  });
  if (error) throw error;
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("sign-in creates a cookie session, honors returnTo, and sign-out clears it", async ({
  page,
}, testInfo) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/auth\/sign-in\?returnTo=%2Fsettings/);

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/settings$/, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /Connections without lock-in/i,
    }),
  ).toBeVisible();

  await page.getByLabel("Display name").fill("Updated Phase Two Listener");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toContainText("Profile updated");

  await signOut(page, testInfo.project.name);
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/library");
  await expect(page).toHaveURL(/\/auth\/sign-in\?returnTo=%2Flibrary/);
});

test("password recovery does not reveal whether an account exists", async ({
  page,
}) => {
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email address").fill("unknown@cratecompass.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");
});

test("account deletion requires the password and removes the auth identity", async ({
  page,
}) => {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/discover$/, { timeout: 20_000 });
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /Connections without lock-in/i,
    }),
  ).toBeVisible();

  await page.getByLabel("Current password").fill(password);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page
    .getByRole("button", { name: "Permanently delete account" })
    .click();

  await expect(page).toHaveURL(/\/\?account=deleted$/);
  const deletedUserId = userId;
  userId = undefined;
  if (!deletedUserId) throw new Error("Test user was not created.");
  const { data, error } = await admin.auth.admin.getUserById(deletedUserId);
  expect(error).toBeTruthy();
  expect(data.user).toBeNull();
});
