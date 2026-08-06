import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

/**
 * The authenticated mood journey, in a browser, end to end.
 *
 * This is the coverage the service and unit suites cannot give: a real account,
 * a real cookie session, real server actions, real Row Level Security, and the
 * real draft round-tripping through Postgres. What is faked is only what may
 * not be real in an automated test — the AI model and Spotify — and both are
 * faked behind the same `PROVIDER_FIXTURES` gate the environment schema
 * refuses to open outside a test environment.
 *
 * Requires `supabase start`. The account is created and deleted per run, so
 * nothing accumulates and the AI usage limiter is never shared between runs.
 */

const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const ANON_KEY =
  process.env.LOCAL_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const PASSWORD = "synthetic-e2e-only-password-9812";

let email = "";
let userId = "";

/**
 * A fresh account per test, not per file.
 *
 * The AI usage limiter allows four requests per user per minute, and one pass
 * through this journey spends three (parse, re-parse on confirm, playlist
 * text). Sharing an account across tests trips a limit that is working
 * correctly — the isolation is the fix, not a larger allowance.
 */
test.beforeEach(async () => {
  email = `mood-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cratecompass.test`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) {
    // Fail loudly rather than skipping: a missing local stack means this
    // coverage silently disappears, which is the outcome it exists to prevent.
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

async function signIn(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/auth/sign-in?returnTo=/mood");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: /Describe the room/i }),
  ).toBeVisible({ timeout: 20_000 });
}

test("a signed-in listener goes from mood to a created playlist", async ({
  page,
}) => {
  await signIn(page);

  // The signed-out gate is gone: the workflow itself is rendered.
  await expect(
    page.getByRole("heading", { name: "Describe the moment" }),
  ).toBeVisible();

  await page
    .getByLabel("What are you listening for?")
    .fill("hazy coastal post-rock for a rainy commute");
  await page.getByRole("button", { name: /Interpret this mood/ }).click();

  // Interpretation states what it understood, and marks what it cannot enforce.
  await expect(
    page.getByRole("heading", { name: "How this was understood" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("hint only").first()).toBeVisible();

  // Seed confirmation is required, and the placeholder entity that outranks
  // real artists in live tag search must not be offered.
  await expect(
    page.getByRole("heading", { name: /Choose the artist/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Various Artists/ }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /Harbour Lantern/ })
    .first()
    .click();

  // The draft is reviewable before anything leaves the application.
  const removeButtons = page.getByRole("button", { name: /^Remove/ });
  await expect(removeButtons.first()).toBeVisible({ timeout: 60_000 });

  const initialCount = await removeButtons.count();
  expect(initialCount).toBeGreaterThan(0);

  await removeButtons.first().click();
  await expect(removeButtons).toHaveCount(initialCount - 1);

  await page
    .getByRole("button", { name: /Create private playlist in Spotify/ })
    .click();

  await expect(
    page.getByRole("heading", { name: "Playlist created" }),
  ).toBeVisible({ timeout: 60_000 });

  const link = page.getByRole("link", { name: /Open in Spotify/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /open\.spotify\.com\/playlist\//);
});

test("a vague description asks one question instead of guessing", async ({
  page,
}) => {
  await signIn(page);

  await page.getByLabel("What are you listening for?").fill("something vague");
  await page.getByRole("button", { name: /Interpret this mood/ }).click();

  await expect(
    page.getByRole("heading", { name: "One question first" }),
  ).toBeVisible({ timeout: 30_000 });

  // Nothing is offered alongside the question: guessing and asking at the same
  // time would make the question rhetorical.
  await expect(
    page.getByRole("heading", { name: /Choose the artist/ }),
  ).toBeHidden();
  await expect(page.getByText(/Nothing has been guessed/)).toBeVisible();
});

test("the staged progress names the step that is running", async ({ page }) => {
  await signIn(page);

  await page
    .getByLabel("What are you listening for?")
    .fill("hazy coastal post-rock");
  await page.getByRole("button", { name: /Interpret this mood/ }).click();

  // The 24-36 paced MusicBrainz requests are why this exists: a silent spinner
  // on the build step reads as a hang.
  await expect(
    page.getByRole("heading", { name: /Choose the artist/ }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("button", { name: /Harbour Lantern/ })
    .first()
    .click();
  await expect(page.getByText("Finding tracks")).toBeVisible();
  await expect(
    page.getByText(/MusicBrainz allows one request per second/),
  ).toBeVisible();

  await expect(
    page.getByRole("button", { name: /^Remove/ }).first(),
  ).toBeVisible({ timeout: 60_000 });
});

/**
 * Reads the listener's own draft identifier.
 *
 * Deliberately not the admin client: `service_role` holds no table grants, so
 * Row Level Security is the only way in, and getting the row back is itself
 * evidence that the draft belongs to the account that made it.
 */
async function readOwnDraftId(): Promise<string> {
  const owner = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });

  const { error: signInError } = await owner.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });

  if (signInError) {
    throw new Error(
      `Could not sign in to read the draft: ${signInError.message}`,
    );
  }

  const { data, error } = await owner
    .from("generated_playlists")
    .select("id")
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `No draft row was readable: ${error?.message ?? "none found"}`,
    );
  }

  return data.id as string;
}

test("a draft survives the navigation a Spotify reconnect forces", async ({
  page,
}) => {
  // The defect this covers: the reconnect prompt promised the draft would be
  // waiting, while the workflow held it in component state that a full-document
  // navigation to Spotify destroys. The row always survived; nothing pointed
  // back at it.
  await signIn(page);

  await page
    .getByLabel("What are you listening for?")
    .fill("hazy coastal post-rock for a rainy commute");
  await page.getByRole("button", { name: /Interpret this mood/ }).click();
  await expect(
    page.getByRole("heading", { name: /Choose the artist/ }),
  ).toBeVisible({ timeout: 30_000 });

  await page
    .getByRole("button", { name: /Harbour Lantern/ })
    .first()
    .click();

  const removeButtons = page.getByRole("button", { name: /^Remove/ });
  await expect(removeButtons.first()).toBeVisible({ timeout: 60_000 });
  const trackCount = await removeButtons.count();

  const playlistId = await readOwnDraftId();

  // A fresh document at the path the reconnect builds. Nothing the browser held
  // a moment ago is still in memory.
  await page.goto(`/mood?draft=${playlistId}&length=20&explicit=avoid`);

  await expect(
    page.getByRole("button", { name: /Create private playlist in Spotify/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(
    trackCount,
  );
  await expect(page.getByLabel("What are you listening for?")).toHaveValue(
    "hazy coastal post-rock for a rainy commute",
  );

  // The setting that is carried rather than stored. Losing it would silently
  // reverse a listener's choice to exclude explicit tracks.
  await expect(page.getByLabel("Exclude explicit tracks")).toBeChecked();
});

test("an unresumable draft identifier gives a fresh workflow, not an error", async ({
  page,
}) => {
  await signIn(page);

  // Someone else's draft, a deleted one, and a hand-typed identifier are
  // indistinguishable from here, and none of them is worth an error screen.
  await page.goto("/mood?draft=00000000-0000-4000-8000-000000000000");

  await expect(
    page.getByRole("heading", { name: "Describe the moment" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await expect(page.getByLabel("What are you listening for?")).toHaveValue("");
});

test("@a11y the authenticated mood workflow has no violations", async ({
  page,
}) => {
  const AxeBuilder = (await import("@axe-core/playwright")).default;

  await signIn(page);
  await page
    .getByLabel("What are you listening for?")
    .fill("hazy coastal post-rock");
  await page.getByRole("button", { name: /Interpret this mood/ }).click();
  await expect(
    page.getByRole("heading", { name: "How this was understood" }),
  ).toBeVisible({ timeout: 30_000 });

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
