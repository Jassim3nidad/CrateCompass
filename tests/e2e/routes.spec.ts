import { expect, test } from "@playwright/test";

const publicRoutes = [
  { path: "/", heading: /Find the thread between records/i },
  { path: "/discover", heading: /Start with a record you already trust/i },
  { path: "/mood", heading: /Describe the room, not a dropdown/i },
  // Not an MBID, so the route resolves to the shell that says so rather than
  // fetching or inventing an artist. Kept as a route on purpose: a real address
  // with an unusable parameter is more actionable than a 404.
  {
    path: "/artists/not-an-mbid",
    heading: /That is not an artist identifier/i,
  },
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

test("the artist shell names the unusable parameter without inventing an artist", async ({
  page,
}) => {
  await page.goto("/artists/not-an-mbid");

  await expect(
    page.getByText('"not-an-mbid" is not a MusicBrainz'),
  ).toBeVisible();
  // The failure worth guarding: a page about nobody that reads like a page
  // about somebody.
  await expect(
    page.getByRole("heading", { name: "Discography" }),
  ).toBeVisible();
  await expect(page.getByText(/arrives in phase/i)).toHaveCount(0);
});
