import { expect, test } from "@playwright/test";

const routes = [
  { path: "/", heading: /Find the thread between records/i },
  { path: "/discover", heading: /Start with a record you already trust/i },
  { path: "/mood", heading: /Describe the room, not a dropdown/i },
  { path: "/artists/foundation-preview", heading: /Artist workspace/i },
  { path: "/library", heading: /The finds you chose to keep/i },
  { path: "/history", heading: /Every trail, easy to retrace/i },
  { path: "/settings", heading: /Connections without lock-in/i },
  { path: "/auth/sign-in", heading: /Welcome back/i },
  { path: "/auth/sign-up", heading: /Build your own trail/i },
  { path: "/auth/callback", heading: /Callback route reserved/i },
] as const;

for (const route of routes) {
  test(`${route.path} renders its route shell`, async ({ page }) => {
    await page.goto(route.path);
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  });
}

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
