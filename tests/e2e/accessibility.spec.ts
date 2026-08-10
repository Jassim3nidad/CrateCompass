import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_SEEDS } from "@/lib/providers/fixtures/catalog";

/**
 * The accessibility gate.
 *
 * Automated scanning is the floor, not the ceiling — axe cannot see keyboard
 * order, focus visibility, or whether a menu can be dismissed — so the scans
 * below are followed by explicit interaction cases for the things it misses.
 * A 3.88:1 contrast defect survived two phases here because no button was ever
 * hovered during a scan, which is why hovered and expanded states are now
 * scanned as states rather than assumed to inherit from the resting one.
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

const PASSWORD = "synthetic-e2e-only-password-4471";

const anonymousPaths = [
  "/",
  "/discover",
  "/mood",
  "/auth/sign-in",
  "/auth/sign-up",
  "/auth/forgot-password",
  "/artists/not-an-mbid",
  "/not-a-real-route",
  // Discovery with results loaded, which is where most of the interactive
  // surface lives: badges, disclosure buttons, and the live region.
  `/discover?q=harbour&artist=${FIXTURE_SEEDS.full}`,
  `/artists/${FIXTURE_SEEDS.full}`,
] as const;

// Every authenticated surface. These were unscanned before Phase 10, which
// left the library's filter groups, the history list and the whole of settings
// outside the gate entirely.
const authenticatedPaths = [
  "/library",
  "/history",
  "/settings",
  "/settings/connections",
] as const;

async function scan(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations;
}

for (const path of anonymousPaths) {
  test(`@a11y ${path} has no automatically detectable violations`, async ({
    page,
  }) => {
    await page.goto(path);
    expect(await scan(page)).toEqual([]);
  });
}

/**
 * One account, one sign-in, four scans.
 *
 * Deliberately not a test per route. Sign-in through `next dev` costs seven to
 * thirteen seconds and each authenticated route compiles on first request, so
 * four separate tests meant four sign-ins and pushed an unrelated spec past its
 * timeout — the exact "suite grew, assertions went marginal" failure the
 * roadmap already tracks. Scanning within one session costs one sign-in and
 * still covers every surface; the assertion names the offending route, so a
 * failure is no harder to read than four tests would have made it.
 */
test("@a11y authenticated surfaces have no automatically detectable violations", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const email = `a11y-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cratecompass.test`;
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

  try {
    const [first] = authenticatedPaths;
    await page.goto(`/auth/sign-in?returnTo=${encodeURIComponent(first)}`);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(`**${first}**`);

    for (const path of authenticatedPaths) {
      await page.goto(path);

      // `<main>` is visible the moment it exists, which on a streamed route is
      // before any of its content has arrived — axe then scans an empty
      // document and reports a missing level-one heading. The heading is the
      // real signal that the page has rendered.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await scan(page), `violations on ${path}`).toEqual([]);
    }
  } finally {
    await admin.auth.admin.deleteUser(data.user.id);
  }
});

test("@a11y an expanded explanation has no violations", async ({ page }) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.full}`);
  await page
    .getByRole("button", { name: /Why this match/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }).first(),
  ).toBeVisible();

  expect(await scan(page)).toEqual([]);
});

test("@a11y the open mobile menu has no violations", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();

  expect(await scan(page)).toEqual([]);
});

test("@a11y the mobile menu closes on Escape and returns focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Open navigation menu" });
  await trigger.click();

  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(menu).toBeHidden();
  // Focus must land somewhere deliberate. Left on <body> a keyboard user
  // restarts from the top of the document with no idea where they were.
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toBeFocused();
});

test("@a11y the mobile menu closes when the page behind it is tapped", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(menu).toBeVisible();

  // A raw coordinate low on the page, not an element: the open panel covers
  // most of what is under the header at this width, so locator-based clicks
  // resolve to the menu itself and would assert nothing.
  await page.mouse.click(20, 700);

  await expect(menu).toBeHidden();
});

test("@a11y the mobile menu reports its expanded state", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Open navigation menu" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();

  await expect(
    page.getByRole("button", { name: "Close navigation menu" }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("@a11y discovery card actions are reachable and visibly focused by keyboard", async ({
  page,
}) => {
  await page.goto(`/discover?q=harbour&artist=${FIXTURE_SEEDS.full}`);

  const save = page.getByRole("button", { name: /^Save/ }).first();
  await expect(save).toBeVisible({ timeout: 30_000 });

  await save.focus();
  await expect(save).toBeFocused();

  // A focus indicator that renders nothing is the failure worth catching. The
  // outline is drawn by `.focus-ring:focus-visible`, and `focus()` alone does
  // not always satisfy :focus-visible — so the check is that the rule applies
  // when the element is reached the way a keyboard user reaches it.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");

  const outlineWidth = await save.evaluate(
    (element) => getComputedStyle(element).outlineWidth,
  );
  expect(outlineWidth).not.toBe("0px");

  // Tab order through the card's actions: save, dismiss, then the Spotify
  // control. Nothing may be skipped and nothing may trap.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: /^Dismiss/ }).first(),
  ).toBeFocused();
});

test("@a11y no route traps keyboard focus", async ({ page }) => {
  for (const path of ["/", "/discover", "/mood", "/auth/sign-in"]) {
    await page.goto(path);

    const reached = new Set<string>();
    let repeats = 0;

    // Forty tabs is comfortably past the control count of the densest of these
    // pages. A trap shows up as the same element being returned over and over.
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const marker = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return "body";
        return `${active.tagName}:${active.getAttribute("aria-label") ?? active.textContent?.trim().slice(0, 30) ?? ""}`;
      });

      if (reached.has(marker)) {
        repeats += 1;
      }
      reached.add(marker);
    }

    // Cycling back to the start after exhausting the page is correct; being
    // stuck on one element is not.
    expect(reached.size, `${path} exposed too few focus stops`).toBeGreaterThan(
      3,
    );
    expect(repeats, `${path} may trap focus`).toBeLessThan(37);
  }
});

test.describe("@a11y reduced motion", () => {
  test("applies no entrance animation when motion is not wanted", async ({
    page,
  }) => {
    // `emulateMedia` rather than the `reducedMotion` test option: it is typed
    // on `page` in this Playwright version, and it puts the preference next to
    // the assertion that depends on it rather than in a describe-block header.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/discover?q=harbour&artist=${FIXTURE_SEEDS.full}`);
    await expect(page.locator("main")).toBeVisible();

    // The motion utilities are declared inside `prefers-reduced-motion:
    // no-preference`, so under `reduce` they resolve to nothing at all rather
    // than to an animation compressed to 0.01ms. `animationName: none` is the
    // observable difference between the two, and is what this asserts.
    const animated = await page.evaluate(() => {
      const selector =
        ".page-shell, .motion-rise, .motion-settle, .motion-expand, .motion-orbit, .motion-draw";

      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => getComputedStyle(element).animationName !== "none")
        .map((element) => element.className.toString().slice(0, 80));
    });

    expect(animated).toEqual([]);
  });

  test("leaves content fully visible rather than stuck mid-animation", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    // The trap in animating entrances: an element whose resting state is
    // `opacity: 0` disappears entirely for anyone who suppressed the animation
    // that would have revealed it.
    const faded = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>(".page-shell")].filter(
          (element) => Number(getComputedStyle(element).opacity) < 1,
        ).length,
    );

    expect(faded).toBe(0);
  });
});
