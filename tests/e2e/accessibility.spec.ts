import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of ["/", "/discover", "/mood", "/auth/sign-in"] as const) {
  test(`@a11y ${path} has no automatically detectable violations`, async ({
    page,
  }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}
