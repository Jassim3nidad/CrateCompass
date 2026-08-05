import { expect, test } from "@playwright/test";

import { FIXTURE_SEEDS } from "@/lib/providers/fixtures/catalog";

/**
 * The discovery journey, end to end, against fixture providers.
 *
 * These run signed out, which is the harder case: every state a listener can
 * reach without an account has to be honest about what it will and will not do
 * for them. The signed-in save and dismiss paths are covered by the service and
 * component suites, because automated tests may not use a real connected
 * account.
 */

test("search offers canonical candidates and does not pick one automatically", async ({
  page,
}) => {
  await page.goto("/discover?q=harbour");

  const candidates = page.getByRole("link", { name: /Harbour Lantern/ });
  await expect(candidates).toHaveCount(2);

  // The two share a name and are told apart only by their disambiguation.
  await expect(page.getByText("Glasgow post-rock group")).toBeVisible();
  await expect(page.getByText("Portland singer-songwriter")).toBeVisible();

  // Nothing has been recommended yet: selection is still the listener's.
  await expect(page.getByRole("heading", { name: /Related to/ })).toBeHidden();
});

test("selecting an artist loads attributed related artists", async ({
  page,
}) => {
  await page.goto("/discover?q=harbour");
  await page
    .getByRole("link", {
      name: /Harbour Lantern[\s\S]*Glasgow post-rock group/,
    })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Harbour Lantern" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Related to Harbour Lantern" }),
  ).toBeVisible();

  const cards = page.getByRole("listitem").filter({ hasText: "Vellum Coast" });
  await expect(cards.first()).toBeVisible();
  await expect(page.getByText("Strong link").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ListenBrainz" }).first(),
  ).toBeVisible();
});

test("an explanation shows traceable evidence before its reading", async ({
  page,
}) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.full}`);

  const disclosure = page
    .getByRole("button", { name: /Why this match/ })
    .first();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");

  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/ListenBrainz ranks Vellum Coast/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reading of the evidence" }),
  ).toBeVisible();

  // Signed out, the summary is deterministic and says so rather than
  // pretending a model wrote it.
  await expect(page.getByText(/Sign in to have this evidence/)).toBeVisible();
});

test("a candidate whose metadata is unavailable is shown as partial", async ({
  page,
}) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.full}`);

  const card = page.getByRole("listitem").filter({ hasText: "Ash Meridian" });
  await card.getByRole("button", { name: /Why this match/ }).click();

  await expect(
    card.getByText(/could not be retrieved, so this rests on similarity data/),
  ).toBeVisible();
  // The relationship itself is still reported, so evidence is not empty.
  await expect(card.getByText(/ListenBrainz ranks Ash Meridian/)).toBeVisible();
});

test("saving signed out invites sign-in instead of failing quietly", async ({
  page,
}) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.full}`);

  await page.getByRole("button", { name: /^Save/ }).first().click();

  await expect(page.getByText(/Sign in to keep this discovery/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in" }).first(),
  ).toBeVisible();
});

test("load more appends the remaining candidates", async ({ page }) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.full}`);

  const cards = page.getByRole("listitem").filter({ hasText: /Provider rank/ });
  await expect(cards).toHaveCount(12);

  await page.getByRole("button", { name: /Load more/ }).click();

  await expect(cards).toHaveCount(15);
  await expect(
    page.getByText(/That is every related artist the provider reported/),
  ).toBeVisible();
});

test("an artist with no reported relationships shows an honest empty state", async ({
  page,
}) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.noResults}`);

  await expect(
    page.getByRole("heading", { name: "No related artists reported" }),
  ).toBeVisible();
  await expect(
    page.getByText(/gap in the data, not proof that none exist/),
  ).toBeVisible();
  // The canonical record is unaffected by the absence of relationships.
  await expect(
    page.getByRole("heading", { level: 1, name: "Quiet Ledger" }),
  ).toBeVisible();
});

test("a discovery provider outage does not take the artist page with it", async ({
  page,
}) => {
  await page.goto(`/discover?artist=${FIXTURE_SEEDS.providerDown}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Broken Signal" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    /discovery provider could not be reached/,
  );
});

test("the whole journey is reachable from the keyboard", async ({ page }) => {
  await page.goto("/discover");

  await page.getByLabel("Artist name").fill("harbour");
  await page.getByLabel("Artist name").press("Enter");

  await expect(
    page.getByRole("heading", { name: /matches for/ }),
  ).toBeVisible();

  const candidate = page
    .getByRole("link", { name: /Harbour Lantern[\s\S]*Glasgow/ })
    .first();
  await candidate.focus();
  await candidate.press("Enter");

  const disclosure = page
    .getByRole("button", { name: /Why this match/ })
    .first();
  await disclosure.focus();
  await expect(disclosure).toBeFocused();

  // The disclosure is a client component, so a keypress before hydration is
  // simply lost. Waiting for the network to settle is what makes this test
  // measure keyboard support rather than device speed.
  await page.waitForLoadState("networkidle");
  await disclosure.press("Enter");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");

  await expect(
    page.getByRole("heading", { name: "Evidence", exact: true }),
  ).toBeVisible();
});

test("the artist page links back into discovery", async ({ page }) => {
  await page.goto(`/artists/${FIXTURE_SEEDS.full}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Harbour Lantern" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Find related artists/ }).click();

  await expect(
    page.getByRole("heading", { name: "Related to Harbour Lantern" }),
  ).toBeVisible();
});

test("discovery results do not overflow horizontally on mobile", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile project only");

  await page.goto(`/discover?q=harbour&artist=${FIXTURE_SEEDS.full}`);
  await expect(page.getByText("Strong link").first()).toBeVisible();

  const hasOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

  expect(hasOverflow).toBe(false);
});
