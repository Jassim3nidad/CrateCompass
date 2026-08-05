import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { FIXTURE_SEEDS } from "@/lib/providers/fixtures/catalog";

const paths = [
  "/",
  "/discover",
  "/mood",
  "/auth/sign-in",
  // Discovery with results loaded, which is where most of the interactive
  // surface lives: badges, disclosure buttons, and the live region.
  `/discover?q=harbour&artist=${FIXTURE_SEEDS.full}`,
  `/artists/${FIXTURE_SEEDS.full}`,
] as const;

for (const path of paths) {
  test(`@a11y ${path} has no automatically detectable violations`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("@a11y an expanded explanation has no violations", async ({ page }) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.full}`);
  await page
    .getByRole("button", { name: /Why this match/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }).first(),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
