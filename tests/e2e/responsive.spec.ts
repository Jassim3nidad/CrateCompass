import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_SEEDS } from "@/lib/providers/fixtures/catalog";

/**
 * Horizontal overflow, at every width the product claims to support.
 *
 * One route at one width was checked before Phase 10, which caught nothing:
 * overflow is produced by long unbroken strings, fixed minimums and wide
 * grids, and those appear on the content-heavy routes at the *narrow* end. 320
 * is the floor `body { min-width }` sets and the narrowest width WCAG 2.2
 * reflow is measured against.
 *
 * `documentElement` rather than `body`: an absolutely positioned child that
 * escapes its container widens the former while leaving the latter unchanged,
 * and that is precisely the bug worth catching.
 */

const WIDTHS = [320, 375, 768, 1024, 1280, 1440, 1920] as const;

const ROUTES = [
  "/",
  "/discover",
  `/discover?q=harbour&artist=${FIXTURE_SEEDS.full}`,
  "/mood",
  `/artists/${FIXTURE_SEEDS.full}`,
  "/artists/not-an-mbid",
  "/auth/sign-in",
  "/auth/sign-up",
  "/not-a-real-route",
] as const;

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;

    if (root.scrollWidth <= root.clientWidth) {
      return null;
    }

    // Naming the widest offender turns "something overflows" into a defect
    // report. Without it this test says a page is broken and nothing else.
    const limit = root.clientWidth;
    const offender = [...document.body.querySelectorAll<HTMLElement>("*")]
      .map((element) => ({
        element,
        right: element.getBoundingClientRect().right,
      }))
      .filter((entry) => entry.right > limit + 1)
      .sort((first, second) => second.right - first.right)[0];

    return {
      scrollWidth: root.scrollWidth,
      clientWidth: limit,
      offender: offender
        ? `${offender.element.tagName.toLowerCase()}.${offender.element.className.toString().slice(0, 120)} (right: ${Math.round(offender.right)})`
        : "no single element exceeds the viewport; check a margin or a grid track",
    };
  });
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const route of ROUTES) {
      test(`${route} does not scroll horizontally`, async ({
        page,
      }, testInfo) => {
        // The mobile project pins a device viewport, so `test.use` above is
        // ignored there and every case would silently measure 412px.
        test.skip(
          testInfo.project.name.includes("mobile"),
          "desktop project drives the width matrix",
        );

        await page.goto(route);
        await expect(page.locator("main")).toBeVisible();

        expect(await horizontalOverflow(page)).toBeNull();
      });
    }
  });
}

test("reflows without horizontal scrolling at 200% zoom", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop project drives the width matrix",
  );

  // WCAG 2.2 §1.4.10 is measured at 1280×1024 scaled to 400%, which for width
  // alone is equivalent to a 320px viewport. 200% zoom on a 1280 laptop is the
  // everyday case and is what this asserts: 640 CSS pixels of usable width.
  await page.setViewportSize({ width: 640, height: 512 });

  for (const route of ["/", "/discover", "/mood", "/auth/sign-in"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeNull();
  }
});

test("every interactive control meets the WCAG 2.2 target-size minimum", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "measured once; the sizes are not viewport-dependent",
  );

  await page.goto(`/discover?q=harbour&artist=${FIXTURE_SEEDS.full}`);
  await expect(page.locator("main")).toBeVisible();

  // §2.5.8 AA is 24×24 with an exception for targets in a sentence. Inline
  // links are excluded here on that basis; buttons, summaries and form
  // controls are not, and the product's own floor is the 44px comfort target.
  const undersized = await page.evaluate(() => {
    const selector = "button, summary, input, select, textarea, [role=button]";

    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width < 24 || box.height < 24;
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        return `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}" ${Math.round(box.width)}x${Math.round(box.height)}`;
      });
  });

  expect(undersized).toEqual([]);
});
