import { expect, test } from "@playwright/test";

/**
 * The mood surface, signed out.
 *
 * The authenticated pipeline is covered by the service, creation and live
 * database suites: it spends metered AI usage and writes durable drafts, so
 * driving it from a browser test would either need a real account or a mock so
 * deep the test would be measuring itself. What belongs here is the gate — a
 * listener without an account must be told why, and pointed somewhere useful.
 */

test("mood explains why it needs an account and offers discovery instead", async ({
  page,
}) => {
  await page.goto("/mood");

  await expect(
    page.getByRole("heading", { level: 1, name: /Describe the room/i }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Sign in to build a playlist" }),
  ).toBeVisible();

  // The reason is stated rather than implied: metered usage and a saved draft.
  await expect(page.getByText(/metered per account/i)).toBeVisible();

  // Scoped to main: the site header carries its own "Sign in" link.
  const main = page.locator("#main-content");
  await expect(main.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Go to discovery" }),
  ).toBeVisible();
});

test("the discovery route stays usable without an account", async ({
  page,
}) => {
  await page.goto("/mood");
  await page.getByRole("link", { name: "Go to discovery" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: /Start with a record/i }),
  ).toBeVisible();
});

test("mood does not overflow horizontally on mobile", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile project only");

  await page.goto("/mood");

  const hasOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

  expect(hasOverflow).toBe(false);
});
