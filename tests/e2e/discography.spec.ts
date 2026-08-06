import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * The discography explorer, in a browser.
 *
 * The assertions that matter most here are the partial-state ones. A degraded
 * answer with no visible indicator is the defect this whole phase descends
 * from: the MusicBrainz lookup subquery capped at 25 silently, and it survived
 * two phases because nothing on screen said the list was short. Producing the
 * signal in the service is not enough — these tests assert it is *rendered*.
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

const PASSWORD = "synthetic-e2e-only-password-9812";

/** 40 release groups, above the silent 25-group lookup cap. */
const PROLIFIC = "f1000000-0000-4000-8000-000000000005";
/** Retrieval genuinely incomplete: 12 held, 288,991 recorded. */
const PLACEHOLDER = "f1000000-0000-4000-8000-000000000006";

let email = "";
let userId = "";

test.beforeEach(async () => {
  email = `discography-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cratecompass.test`;

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

  userId = data.user.id;
});

test.afterEach(async () => {
  if (userId) {
    await admin.auth.admin.deleteUser(userId);
    userId = "";
  }
});

async function signIn(
  page: import("@playwright/test").Page,
  returnTo: string,
): Promise<void> {
  await page.goto(`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(`**${returnTo}`, { timeout: 20_000 });
}

test("the timeline lists every release group and filters by type", async ({
  page,
}) => {
  await page.goto(`/artists/${PROLIFIC}`);

  await expect(
    page.getByRole("heading", { name: "Releases", exact: true }),
  ).toBeVisible();

  // All 40, not the 25 the lookup subquery would have returned.
  await expect(page.getByRole("button", { name: /^All \(40\)/ })).toBeVisible();

  // Filtering narrows the list rather than re-fetching a different one.
  const albums = page.getByRole("button", { name: /^Albums \(/ });
  await expect(albums).toBeVisible();
  await albums.click();
  await expect(albums).toHaveAttribute("aria-pressed", "true");
});

test("a complete discography says so rather than staying silent", async ({
  page,
}) => {
  await page.goto(`/artists/${PROLIFIC}`);

  await expect(page.getByText(/40 release groups recorded by/)).toBeVisible();
  await expect(
    page.getByText("Partial discography", { exact: true }),
  ).toHaveCount(0);
});

test("an incomplete retrieval is badged and quantified on screen", async ({
  page,
}) => {
  await page.goto(`/artists/${PLACEHOLDER}`);

  // The badge, adjacent to the heading rather than buried at the foot.
  await expect(
    page.getByText("Partial discography", { exact: true }),
  ).toBeVisible();

  // Real numbers, not a vague warning.
  await expect(
    page.getByText(/Showing 12 of 288,991 release groups/),
  ).toBeVisible();
  await expect(
    page.getByText(/counts drawn from it would be wrong/),
  ).toBeVisible();
});

test("a grounded answer cites the records it used", async ({ page }) => {
  await signIn(page, `/artists/${PROLIFIC}`);

  await page
    .getByLabel("Your question")
    .fill("what was their first studio album?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(page.getByText("Drawn from these records")).toBeVisible({
    timeout: 30_000,
  });

  // The citation links back to the source, which is the checkable half.
  const sourceLink = page
    .getByRole("link", { name: /MusicBrainz record for/ })
    .first();
  await expect(sourceLink).toBeVisible();
  await expect(sourceLink).toHaveAttribute(
    "href",
    /musicbrainz\.org\/release-group\//,
  );
});

test("a counting question against a partial discography is refused, not guessed", async ({
  page,
}) => {
  await signIn(page, `/artists/${PLACEHOLDER}`);

  await page
    .getByLabel("Your question")
    .fill("how many studio albums are recorded here?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await expect(
    page.getByText(/a count would be wrong rather than approximate/),
  ).toBeVisible({ timeout: 30_000 });

  // Nothing is invented alongside the refusal.
  await expect(page.getByText("Drawn from these records")).toHaveCount(0);
  await expect(page.getByText(/Nothing has been guessed/)).toBeVisible();
});

test("an answer from a partial retrieval carries the caveat with it", async ({
  page,
}) => {
  await signIn(page, `/artists/${PLACEHOLDER}`);

  await page.getByLabel("Your question").fill("what was their first release?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  // The caveat sits with the answer, not at the foot of the page, so it cannot
  // be scrolled away from the claim it qualifies.
  await expect(
    page.getByText(/full discography could not be retrieved/),
  ).toBeVisible({ timeout: 30_000 });
});

test("the conversation is still there after a reload", async ({ page }) => {
  await signIn(page, `/artists/${PROLIFIC}`);

  await page.getByLabel("Your question").fill("what was their first release?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Drawn from these records")).toBeVisible({
    timeout: 30_000,
  });

  await page.reload();

  await expect(page.getByText(/Earlier questions about/)).toBeVisible();
});

test("questions need an account, browsing does not", async ({ page }) => {
  await page.goto(`/artists/${PROLIFIC}`);

  await expect(
    page.getByRole("heading", { name: "Releases", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Your question")).toBeDisabled();
  await expect(page.getByText(/Sign in to ask questions/)).toBeVisible();
});

test("@a11y the discography explorer has no violations", async ({ page }) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await signIn(page, `/artists/${PLACEHOLDER}`);

  await expect(
    page.getByText("Partial discography", { exact: true }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("@a11y the filter chips keep sufficient contrast when hovered", async ({
  page,
}) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await page.goto(`/artists/${PROLIFIC}`);

  // Hover states are the gap an ordinary scan misses: a 3.88:1 contrast defect
  // survived two phases because no button was hovered during a scan.
  await page.getByRole("button", { name: /^Albums \(/ }).hover();

  const results = await new AxeBuilder({ page })
    .include('[aria-label="Filter releases by type"]')
    .analyze();

  expect(results.violations).toEqual([]);
});
