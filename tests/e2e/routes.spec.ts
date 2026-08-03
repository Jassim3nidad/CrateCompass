import { expect, test } from "@playwright/test";

const publicRoutes = [
  { path: "/", heading: /Find the thread between records/i },
  { path: "/discover", heading: /Start with a record you already trust/i },
  { path: "/mood", heading: /Describe the room, not a dropdown/i },
  { path: "/artists/foundation-preview", heading: /Artist workspace/i },
  { path: "/auth/sign-in", heading: /Welcome back/i },
  { path: "/auth/sign-up", heading: /Build your own trail/i },
  { path: "/auth/forgot-password", heading: /Reset your password/i },
  { path: "/auth/update-password", heading: /Choose a new password/i },
] as const;

for (const route of publicRoutes) {
  test(`${route.path} renders`, async ({ page }) => {
    await page.goto(route.path);
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  });
}

for (const path of ["/library", "/history", "/settings"] as const) {
  test(`${path} redirects anonymous visitors to sign in`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(
      new RegExp(`/auth/sign-in\\?returnTo=${encodeURIComponent(path)}`),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: /Welcome back/i }),
    ).toBeVisible();
  });
}

test("an invalid callback fails closed", async ({ page }) => {
  await page.goto("/auth/callback");
  await expect(page).toHaveURL(/\/auth\/error\?reason=invalid-or-expired/);
  await expect(
    page.getByRole("heading", { level: 1, name: /That link cannot be used/i }),
  ).toBeVisible();
});

test("keyboard navigation exposes the skip link", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
});

test("mobile routes do not overflow horizontally", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile project only");
  await page.goto("/discover");
  const hasOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
});
