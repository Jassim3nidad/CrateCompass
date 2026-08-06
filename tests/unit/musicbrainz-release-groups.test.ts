import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real pacer spaces requests a second apart, which is correct in
// production and pointless here: these tests assert paging arithmetic, not
// politeness, and six pages would otherwise cost six seconds.
vi.mock("@/lib/providers/musicbrainz/pacer", () => ({
  paced: <T>(operation: () => Promise<T>) => operation(),
  resetPacerForTesting: () => undefined,
  PACER_INTERVAL_MS: 0,
}));

import {
  browseReleaseGroups,
  clearMusicBrainzCachesForTesting,
  lookupArtist,
} from "@/lib/providers/musicbrainz/client";

/**
 * Regression cover for the silent release-group truncation.
 *
 * MusicBrainz caps the `release-groups` lookup subquery at 25 and says nothing
 * about it. Portishead has exactly 25, so every fixture and every live check
 * through two phases looked correct while Nirvana's 573 were being reported as
 * 25 — a false count on the artist page and a truncated album list feeding
 * playlist building.
 *
 * The shape of these tests matters: an artist *above* the cap is the case that
 * was missing, so it is the case asserted first.
 */

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function releaseGroup(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `Release ${index}`,
    "primary-type": "Album",
    "secondary-types": index % 2 === 0 ? ["Compilation"] : [],
    "first-release-date": `${1990 + (index % 30)}`,
  };
}

function artistPayload(releaseGroupCount: number) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Prolific Artist",
    "sort-name": "Prolific Artist",
    aliases: [],
    genres: [],
    tags: [],
    "release-groups": Array.from({ length: releaseGroupCount }, (_, index) =>
      releaseGroup(index),
    ),
  };
}

let requestedUrls: string[] = [];

beforeEach(() => {
  clearMusicBrainzCachesForTesting();
  requestedUrls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Serves an artist lookup plus paginated browse responses. */
function stubProvider(total: number): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("/ws/2/artist/")) {
      // The live service returns at most 25 here, whatever the real total is.
      return jsonResponse(artistPayload(Math.min(total, 25)));
    }

    const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? "0");
    const limit = Number(/limit=(\d+)/.exec(url)?.[1] ?? "100");
    const page = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, index) => releaseGroup(offset + index),
    );

    return jsonResponse({
      "release-group-count": total,
      "release-groups": page,
    });
  }) as typeof globalThis.fetch;
}

describe("release-group retrieval above the lookup cap", () => {
  it("retrieves every release group for an artist with more than 25", async () => {
    stubProvider(573);

    const result = await lookupArtist("11111111-1111-4111-8111-111111111111");

    // The bug: this used to be 25, silently.
    expect(result.releases).toHaveLength(573);
    expect(result.releaseGroupTotal).toBe(573);
    expect(result.releasesComplete).toBe(true);
  });

  it("reports the true total rather than the number the lookup returned", async () => {
    stubProvider(573);

    const result = await lookupArtist("11111111-1111-4111-8111-111111111111");

    expect(result.releaseGroupTotal).not.toBe(25);
    expect(result.releaseGroupTotal).toBe(result.releases.length);
  });

  it("finds studio albums that sit beyond the first 25", async () => {
    stubProvider(573);

    const result = await lookupArtist("11111111-1111-4111-8111-111111111111");
    const studioAlbums = result.releases.filter(
      (release) =>
        release.primaryType === "Album" && release.secondaryTypes.length === 0,
    );

    // Nirvana's first 100 groups hold 3 plain studio albums and 52
    // compilations, so truncation does not merely shorten the list — it
    // changes which albums exist as far as the product is concerned.
    expect(studioAlbums.length).toBeGreaterThan(100);
  });

  it("pages through the browse endpoint rather than requesting one huge page", async () => {
    stubProvider(573);

    await lookupArtist("11111111-1111-4111-8111-111111111111");

    const browseCalls = requestedUrls.filter((url) =>
      url.includes("/ws/2/release-group?"),
    );

    expect(browseCalls).toHaveLength(6);
    expect(browseCalls[0]).toContain("offset=0");
    expect(browseCalls[5]).toContain("offset=500");
  });
});

describe("release-group retrieval at or below the cap", () => {
  it("does not pay for pagination when the lookup already returned everything", async () => {
    stubProvider(12);

    const result = await lookupArtist("11111111-1111-4111-8111-111111111111");

    expect(result.releases).toHaveLength(12);
    expect(result.releaseGroupTotal).toBe(12);
    expect(result.releasesComplete).toBe(true);
    // One request, as before the fix: the common case must not get slower.
    expect(
      requestedUrls.filter((url) => url.includes("/ws/2/release-group?")),
    ).toHaveLength(0);
  });

  it("escalates for an artist with exactly the cap, because 25 is ambiguous", async () => {
    stubProvider(25);

    const result = await lookupArtist("11111111-1111-4111-8111-111111111111");

    // 25 could mean "25 groups" or "the first 25 of many". Only the browse
    // endpoint can tell the difference, so it is always consulted.
    expect(
      requestedUrls.filter((url) => url.includes("/ws/2/release-group?")),
    ).not.toHaveLength(0);
    expect(result.releaseGroupTotal).toBe(25);
    expect(result.releasesComplete).toBe(true);
  });
});

describe("pathological catalogues", () => {
  it("stops at the safety bound and reports the retrieval as incomplete", async () => {
    // The "Various Artists" entity holds 288,991 release groups: roughly
    // three-quarters of an hour at one request per second.
    stubProvider(288_991);

    const result = await lookupArtist("11111111-1111-4111-8111-111111111111");

    expect(result.releases).toHaveLength(1000);
    expect(result.releaseGroupTotal).toBe(288_991);
    // The interface can then say so, instead of presenting 1,000 as the whole.
    expect(result.releasesComplete).toBe(false);
  });
});

describe("browse pagination", () => {
  it("returns the provider's own total alongside the page", async () => {
    stubProvider(573);

    const page = await browseReleaseGroups({
      artistMbid: "11111111-1111-4111-8111-111111111111",
      limit: 100,
      offset: 100,
    });

    expect(page.total).toBe(573);
    expect(page.releases).toHaveLength(100);
  });

  it("preserves release type and date precision through the browse path", async () => {
    stubProvider(573);

    const page = await browseReleaseGroups({
      artistMbid: "11111111-1111-4111-8111-111111111111",
      limit: 2,
      offset: 0,
    });

    expect(page.releases[0]?.secondaryTypes).toEqual(["Compilation"]);
    expect(page.releases[1]?.secondaryTypes).toEqual([]);
    expect(page.releases[0]?.firstReleaseDate.precision).toBe("year");
  });
});
