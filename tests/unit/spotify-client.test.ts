import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addPlaylistItems,
  createPlaylist,
  getCurrentUser,
  PLAYLIST_ITEM_BATCH_LIMIT,
  SEARCH_RESULT_LIMIT,
  search,
  __testing,
} from "@/lib/providers/spotify/client";
import {
  asSpotifyResourceId,
  asSpotifyUri,
} from "@/lib/providers/spotify/types";

const { resolveRequest, classify, backoffDelayMs } = __testing;

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("endpoint allowlist", () => {
  it("uses the current playlist paths, never the deprecated ones", () => {
    expect(resolveRequest({ kind: "current-user" }).path).toBe("/v1/me");

    expect(
      resolveRequest({ kind: "create-playlist", name: "n", description: null })
        .path,
    ).toBe("/v1/me/playlists");

    const addItems = resolveRequest({
      kind: "add-playlist-items",
      playlistId: asSpotifyResourceId("playlist1"),
      uris: [asSpotifyUri("spotify:track:1")],
    });

    expect(addItems.path).toBe("/v1/playlists/playlist1/items");
    expect(addItems.path).not.toContain("/tracks");
  });

  it("never constructs a removed or prohibited endpoint", () => {
    const paths = [
      resolveRequest({ kind: "current-user" }).path,
      resolveRequest({
        kind: "search",
        query: "q",
        types: ["artist"],
        limit: 5,
      }).path,
      resolveRequest({ kind: "create-playlist", name: "n", description: null })
        .path,
      resolveRequest({
        kind: "add-playlist-items",
        playlistId: asSpotifyResourceId("p"),
        uris: [asSpotifyUri("spotify:track:1")],
      }).path,
    ];

    const prohibited = [
      "/related-artists",
      "/recommendations",
      "/audio-features",
      "/audio-analysis",
      "/browse/",
      "/top-tracks",
      "/users/",
      "/me/tracks",
      "/me/following",
      "/markets",
    ];

    for (const path of paths) {
      for (const fragment of prohibited) {
        expect(path).not.toContain(fragment);
      }
    }
  });

  it("creates playlists as private, matching the granted scope", () => {
    const request = resolveRequest({
      kind: "create-playlist",
      name: "Night drive",
      description: null,
    });

    expect(request.body).toMatchObject({ public: false, collaborative: false });
  });

  it("refuses a search limit above Spotify's February 2026 cap", () => {
    expect(SEARCH_RESULT_LIMIT).toBe(10);
    expect(() =>
      resolveRequest({
        kind: "search",
        query: "q",
        types: ["artist"],
        limit: 11,
      }),
    ).toThrow(/between 1 and 10/);
  });

  it("refuses more than 100 playlist items in one request", () => {
    expect(PLAYLIST_ITEM_BATCH_LIMIT).toBe(100);
    expect(() =>
      resolveRequest({
        kind: "add-playlist-items",
        playlistId: asSpotifyResourceId("p"),
        uris: Array.from({ length: 101 }, () =>
          asSpotifyUri("spotify:track:1"),
        ),
      }),
    ).toThrow(/between 1 and 100/);
  });
});

describe("error classification", () => {
  it("separates quota exhaustion from rolling-window rate limiting", () => {
    expect(classify(429, "QUOTA_EXCEEDED", 5).kind).toBe("quota-exceeded");
    expect(classify(429, undefined, 5).kind).toBe("rate-limited");
  });

  it("treats a development-mode 403 as an allowlist problem by default", () => {
    expect(classify(403, undefined, undefined).kind).toBe("not-allowlisted");
    expect(classify(403, "insufficient_scope", undefined).kind).toBe(
      "insufficient-scope",
    );
  });

  it("maps 401 to unauthorized and 5xx to unavailable", () => {
    expect(classify(401, undefined, undefined).kind).toBe("unauthorized");
    expect(classify(503, undefined, undefined).kind).toBe("unavailable");
  });
});

describe("retry timing", () => {
  it("honours Retry-After in seconds over its own backoff", () => {
    expect(backoffDelayMs(1, 7)).toBe(7000);
    expect(backoffDelayMs(3, 2)).toBe(2000);
  });

  it("caps a very large Retry-After", () => {
    expect(backoffDelayMs(1, 9999)).toBe(20_000);
  });

  it("backs off exponentially with jitter when no header is present", () => {
    expect(backoffDelayMs(1)).toBeGreaterThanOrEqual(500);
    expect(backoffDelayMs(1)).toBeLessThan(750);
    expect(backoffDelayMs(2)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelayMs(3)).toBeGreaterThanOrEqual(2000);
  });

  it("retries a 429 and succeeds, waiting the advertised time", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { status: 429 } }, 429, { "retry-after": "0" }),
      )
      .mockResolvedValueOnce(jsonResponse({ account_id: "account-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const profile = await getCurrentUser("token");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(profile.accountId).toBe("account-1");
  });

  it("does not retry a 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { status: 401 } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentUser("token")).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("current user", () => {
  it("links on account_id, not the deprecated id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          account_id: "stable-account-id",
          id: "deprecated-user-id",
          display_name: "Listener",
        }),
      ),
    );

    const profile = await getCurrentUser("token");

    expect(profile.accountId).toBe("stable-account-id");
    expect(profile.accountId).not.toBe("deprecated-user-id");
  });

  it("rejects a response with no account identifier rather than guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ id: "only-legacy-id" })),
    );

    await expect(getCurrentUser("token")).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("sends the token as a bearer header and nowhere else", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ account_id: "a" }));
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentUser("secret-access-token");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("secret-access-token");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer secret-access-token",
    );
  });
});

describe("playlist operations", () => {
  it("returns the created playlist identifiers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ id: "playlist-1", uri: "spotify:playlist:1" }, 201),
        ),
    );

    const playlist = await createPlaylist("token", { name: "Night drive" });

    expect(playlist.id).toBe("playlist-1");
  });

  it("returns the snapshot id after adding items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ snapshot_id: "snap-1" }, 201)),
    );

    await expect(
      addPlaylistItems("token", {
        playlistId: asSpotifyResourceId("playlist-1"),
        uris: [asSpotifyUri("spotify:track:1")],
      }),
    ).resolves.toBe("snap-1");
  });

  it("caps the search request at the documented limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ artists: { items: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await search("token", { query: "portishead", types: ["artist"] });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("limit=10");
  });
});
