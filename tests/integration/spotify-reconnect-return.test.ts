import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where the reconnect round trip is told to come back to.
 *
 * The mood flow's promise that a draft is waiting after a reconnect has two
 * legs. The end-to-end suite covers the second — a fresh document at the resume
 * path restores the draft. This covers the first, which no browser test can
 * reach without a real Spotify authorization: that the path the listener asked
 * to return to is what gets written into the OAuth transaction, and that it is
 * sanitised on the way in rather than trusted.
 */

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  beginOAuthTransaction: vi.fn(),
  redirect: vi.fn(),
  isSpotifyConfigured: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/auth")>()),
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

vi.mock("@/lib/providers/spotify/repository", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/providers/spotify/repository")
  >()),
  beginOAuthTransaction: mocks.beginOAuthTransaction,
}));

vi.mock("@/lib/providers/spotify/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/spotify/config")>()),
  isSpotifyConfigured: mocks.isSpotifyConfigured,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

const { connectSpotify, reconnectSpotify } =
  await import("@/features/spotify/actions");

const USER = "11111111-1111-4111-8111-111111111111";
const DRAFT = "22222222-2222-4222-8222-222222222222";

function storedRedirectPath(): string {
  return mocks.beginOAuthTransaction.mock.calls[0]?.[0]?.redirectPath;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ user: { id: USER } });
  mocks.isSpotifyConfigured.mockReturnValue(true);
  mocks.beginOAuthTransaction.mockResolvedValue(undefined);
});

describe("reconnect return path", () => {
  it("records the mood resume path the listener asked to come back to", async () => {
    await reconnectSpotify(`/mood?draft=${DRAFT}&length=20&explicit=avoid`);

    expect(storedRedirectPath()).toBe(
      `/mood?draft=${DRAFT}&length=20&explicit=avoid`,
    );
  });

  it("keeps the query string, because the draft identity lives in it", async () => {
    await reconnectSpotify(`/mood?draft=${DRAFT}&explicit=avoid`);

    const stored = new URL(storedRedirectPath(), "https://x.invalid");
    expect(stored.searchParams.get("draft")).toBe(DRAFT);
    expect(stored.searchParams.get("explicit")).toBe("avoid");
  });

  it.each([
    "https://evil.example/mood",
    "//evil.example/mood",
    "javascript:alert(1)",
    "",
  ])("refuses %s and falls back to the connections page", async (candidate) => {
    // The path arrives from a client component, so it is sanitised rather than
    // trusted. An absolute or protocol-relative target is what would turn this
    // into an open redirect.
    await reconnectSpotify(candidate);

    expect(storedRedirectPath()).toBe("/settings/connections");
  });

  it("still sends the connections page to itself", async () => {
    await connectSpotify();

    expect(storedRedirectPath()).toBe("/settings/connections");
  });

  it("does not start an authorization when Spotify is not configured", async () => {
    mocks.isSpotifyConfigured.mockReturnValue(false);

    const result = await reconnectSpotify(`/mood?draft=${DRAFT}`);

    expect(result.status).toBe("error");
    expect(mocks.beginOAuthTransaction).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
