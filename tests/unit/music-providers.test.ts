import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSimilarityCacheForTesting,
  createListenBrainzProvider,
} from "@/lib/providers/discovery/listenbrainz";
import { DiscoveryProviderError } from "@/lib/providers/discovery/port";
import {
  buildUserAgent,
  clearMusicBrainzCachesForTesting,
  lookupArtist,
  MusicBrainzError,
  parsePartialDate,
  searchArtists,
} from "@/lib/providers/musicbrainz/client";
import {
  PACER_INTERVAL_MS,
  resetPacerForTesting,
} from "@/lib/providers/musicbrainz/pacer";
import { asMusicBrainzId } from "@/types/music";

const REFERENCE_MBID = "8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11";

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

beforeEach(() => {
  resetPacerForTesting();
  // Provider reads are cached, so cases that reuse a query would otherwise
  // share a result and never reach the stubbed fetch.
  clearMusicBrainzCachesForTesting();
  clearSimilarityCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MusicBrainz User-Agent", () => {
  it("uses the format MusicBrainz requires", () => {
    expect(buildUserAgent()).toBe(
      "CrateCompass/0.1.0 ( synthetic-test@cratecompass.invalid )",
    );
  });

  it("sends it on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ artists: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchArtists("portishead");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain(
      "CrateCompass/0.1.0",
    );
  });

  it("matches the Application/version ( contact ) format MusicBrainz requires", () => {
    expect(buildUserAgent()).toMatch(/^\S+\/\S+ \( .+ \)$/);
  });
});

describe("partial dates", () => {
  it.each([
    ["1997", "year"],
    ["1997-09", "month"],
    ["1997-09-29", "day"],
  ])("preserves the precision of %s", (value, precision) => {
    expect(parsePartialDate(value)).toEqual({ value, precision });
  });

  it("does not invent a date when none is recorded", () => {
    expect(parsePartialDate(null)).toEqual({
      value: null,
      precision: "unknown",
    });
    expect(parsePartialDate(undefined)).toEqual({
      value: null,
      precision: "unknown",
    });
  });
});

describe("MusicBrainz search", () => {
  it("normalises candidates and attaches provenance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          artists: [
            {
              id: REFERENCE_MBID,
              name: "Portishead",
              "sort-name": "Portishead",
              disambiguation: "UK trip-hop group",
              type: "Group",
              country: "GB",
              score: 100,
            },
          ],
        }),
      ),
    );

    const [candidate] = await searchArtists("portishead");

    expect(candidate?.mbid).toBe(REFERENCE_MBID);
    expect(candidate?.disambiguation).toBe("UK trip-hop group");
    expect(candidate?.attribution.provenance).toBe("musicbrainz");
    expect(candidate?.attribution.sourceUrl).toContain(REFERENCE_MBID);
  });

  it("caps the requested limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ artists: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchArtists("x", { limit: 500 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("limit=25");
  });

  it("rejects a malformed response rather than trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })),
    );

    await expect(searchArtists("x")).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("retries a 503 and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ artists: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchArtists("x")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("does not retry a 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchArtists("x")).rejects.toBeInstanceOf(MusicBrainzError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("MusicBrainz lookup", () => {
  it("requests aliases and release groups, and preserves release types", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: REFERENCE_MBID,
        name: "Portishead",
        "sort-name": "Portishead",
        type: "Group",
        country: "GB",
        aliases: [{ name: "Portished", "sort-name": null, primary: false }],
        "release-groups": [
          {
            id: "rg-1",
            title: "Dummy",
            "primary-type": "Album",
            "secondary-types": [],
            "first-release-date": "1994-08-22",
          },
          {
            id: "rg-2",
            title: "Roseland NYC Live",
            "primary-type": "Album",
            "secondary-types": ["Live"],
            "first-release-date": "1998",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { artist, releases } = await lookupArtist(REFERENCE_MBID);
    const [url] = fetchMock.mock.calls[0] as [string];

    expect(url).toContain("inc=aliases+release-groups");
    expect(artist.aliases).toHaveLength(1);
    expect(releases[0]?.firstReleaseDate).toEqual({
      value: "1994-08-22",
      precision: "day",
    });
    expect(releases[1]?.secondaryTypes).toEqual(["Live"]);
    expect(releases[1]?.firstReleaseDate.precision).toBe("year");
  });
});

describe("MusicBrainz pacing", () => {
  it("spaces consecutive requests by at least one second", async () => {
    // A fresh Response per call: a body can only be read once.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse({ artists: [] })),
    );

    const startedAt = Date.now();
    await searchArtists("first");
    await searchArtists("second");

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(PACER_INTERVAL_MS);
  }, 10_000);
});

describe("ListenBrainz similar artists", () => {
  const provider = createListenBrainzProvider();

  it("maps MBID-native candidates and sorts by score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse([
          {
            artist_mbid: "mbid-low",
            name: "Lower",
            comment: "",
            type: "Group",
            gender: null,
            score: 12,
            reference_mbid: REFERENCE_MBID,
          },
          {
            artist_mbid: "mbid-high",
            name: "Higher",
            comment: "trip hop",
            type: "Group",
            gender: null,
            score: 98,
            reference_mbid: REFERENCE_MBID,
          },
        ]),
      ),
    );

    const evidence = await provider.findSimilarArtists({
      mbid: asMusicBrainzId(REFERENCE_MBID),
    });

    expect(evidence.candidates.map((c) => c.name)).toEqual(["Higher", "Lower"]);
    expect(evidence.candidates[0]?.mbid).toBe("mbid-high");
    expect(evidence.candidates[0]?.attribution.provenance).toBe("listenbrainz");
    expect(evidence.algorithm).toContain("session_based");
  });

  it("fails loudly when any row is malformed, rather than skipping it", async () => {
    // This previously skipped unparseable rows, which meant a wholly malformed
    // response reached the caller as zero similar artists — indistinguishable
    // from the genuine empty result the endpoint returns for an unknown MBID.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse([
            { some: "unexpected shape" },
            { artist_mbid: "mbid-ok", name: "Real", score: 50 },
          ]),
        ),
    );

    await expect(
      provider.findSimilarArtists({ mbid: asMusicBrainzId(REFERENCE_MBID) }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("distinguishes a malformed response from a genuinely empty one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));

    const evidence = await provider.findSimilarArtists({
      mbid: asMusicBrainzId(REFERENCE_MBID),
    });

    // An unknown MBID really does return 200 with [], so empty is a valid
    // answer and must not be conflated with a schema failure.
    expect(evidence.candidates).toEqual([]);
  });

  it("reports an unknown algorithm as invalid-request, not as an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><title>400 Bad Request</title>", {
          status: 400,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(
      provider.findSimilarArtists({ mbid: asMusicBrainzId(REFERENCE_MBID) }),
    ).rejects.toMatchObject({ kind: "invalid-request" });
  });

  it("retries once on a transient failure, then fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const evidence = await provider.findSimilarArtists({
      mbid: asMusicBrainzId(REFERENCE_MBID),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(evidence.candidates).toEqual([]);
  });

  it("gives up after the single retry", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({}, 502));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provider.findSimilarArtists({ mbid: asMusicBrainzId(REFERENCE_MBID) }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honours the rate-limit reset header on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({}, 429, { "x-ratelimit-reset-in": "17" }),
        ),
    );

    await expect(
      provider.findSimilarArtists({ mbid: asMusicBrainzId(REFERENCE_MBID) }),
    ).rejects.toMatchObject({ kind: "rate-limited", retryAfterSeconds: 17 });
  });

  it("rejects a non-array payload as invalid-response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ not: "an array" })),
    );

    await expect(
      provider.findSimilarArtists({ mbid: asMusicBrainzId(REFERENCE_MBID) }),
    ).rejects.toBeInstanceOf(DiscoveryProviderError);
  });

  it("reports tag search as unsupported rather than returning nothing", async () => {
    await expect(
      provider.findArtistsByTags({ tags: ["trip hop"] }),
    ).rejects.toMatchObject({ kind: "unsupported" });
    await expect(
      provider.findTracksByTags({ tags: ["trip hop"] }),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });

  it("sends no Authorization header when no token is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await provider.findSimilarArtists({
      mbid: asMusicBrainzId(REFERENCE_MBID),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });
});
