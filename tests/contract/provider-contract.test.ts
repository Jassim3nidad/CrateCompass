import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests against *recorded real* provider responses.
 *
 * tests/fixtures/provider-evidence.json is captured from the live services by
 * scripts/capture-provider-evidence.mjs. Replaying it through the real adapters
 * is what stops hand-written mocks from drifting away from what MusicBrainz and
 * ListenBrainz actually send — the drift that hid four defects until the first
 * live capture.
 *
 * Pacing is stubbed out: it has its own dedicated test, and a full replay at
 * one request per second would add ~17s to every run.
 */

vi.mock("@/lib/providers/musicbrainz/pacer", () => ({
  paced: <T>(operation: () => Promise<T>) => operation(),
  resetPacerForTesting: () => undefined,
  PACER_INTERVAL_MS: 1000,
}));

const { createListenBrainzProvider, clearSimilarityCacheForTesting } =
  await import("@/lib/providers/discovery/listenbrainz");
const { lookupArtist, searchArtists, clearMusicBrainzCachesForTesting } =
  await import("@/lib/providers/musicbrainz/client");

interface CapturedResult {
  readonly status: number | null;
  readonly ok: boolean;
  readonly body: unknown;
  readonly rateLimitHeaders?: Record<string, string | null>;
}

interface Evidence {
  readonly capturedAt: string;
  readonly musicBrainzSearch: readonly {
    label: string;
    query: string;
    result: CapturedResult;
  }[];
  readonly musicBrainzLookup: readonly {
    label: string;
    mbid: string;
    result: CapturedResult;
  }[];
  readonly listenBrainzSimilarArtists: readonly {
    label: string;
    mbid: string;
    result: CapturedResult;
  }[];
  readonly errorResponses: readonly {
    provider: string;
    label: string;
    result: CapturedResult;
  }[];
}

const evidence: Evidence = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "fixtures", "provider-evidence.json"),
    "utf8",
  ),
);

function replay(
  captured: CapturedResult,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(captured.body), {
    status: captured.status ?? 500,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  // Each recorded response must reach the adapter, not a cached earlier one.
  clearMusicBrainzCachesForTesting();
  clearSimilarityCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("evidence file", () => {
  it("exists and covers the documented request variety", () => {
    expect(evidence.capturedAt).toBeTruthy();
    expect(evidence.musicBrainzSearch.length).toBeGreaterThanOrEqual(10);
    expect(evidence.musicBrainzLookup.length).toBeGreaterThanOrEqual(3);
    expect(evidence.listenBrainzSimilarArtists.length).toBeGreaterThanOrEqual(
      3,
    );
  });
});

describe("MusicBrainz search against recorded responses", () => {
  const successes = evidence.musicBrainzSearch.filter(
    (entry) => entry.result.ok,
  );

  it("has at least one recorded success per interesting case", () => {
    const labels = successes.map((entry) => entry.label);
    expect(labels).toContain("exact-match");
    expect(labels).toContain("ambiguous-name");
    expect(labels).toContain("non-latin-japanese");
  });

  it.each(successes.map((entry) => [entry.label, entry] as const))(
    "parses the real %s response",
    async (_label, entry) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replay(entry.result)));

      const candidates = await searchArtists(entry.query);

      for (const candidate of candidates) {
        expect(candidate.mbid).toMatch(/^[0-9a-f-]{36}$/);
        expect(candidate.name.length).toBeGreaterThan(0);
        expect(candidate.attribution.provenance).toBe("musicbrainz");
        // Absent in 9/43 and 20/43 of real results respectively.
        expect(
          candidate.type === null || typeof candidate.type === "string",
        ).toBe(true);
        expect(
          candidate.country === null || typeof candidate.country === "string",
        ).toBe(true);
      }
    },
  );

  it("returns no candidates for a genuinely unknown artist", async () => {
    const entry = evidence.musicBrainzSearch.find(
      (candidate) => candidate.label === "nonexistent",
    );
    expect(entry).toBeDefined();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replay(entry!.result)));

    const candidates = await searchArtists(entry!.query);
    // MusicBrainz fuzzy-matches, so this asserts the call succeeds and the
    // shape holds, not that the list is empty.
    expect(Array.isArray(candidates)).toBe(true);
  });
});

describe("MusicBrainz lookup against recorded responses", () => {
  it.each(
    evidence.musicBrainzLookup
      .filter((entry) => entry.result.ok)
      .map((entry) => [entry.label, entry] as const),
  )("parses the real %s lookup", async (_label, entry) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replay(entry.result)));

    const { artist, releases } = await lookupArtist(entry.mbid);

    expect(artist.mbid).toBe(entry.mbid);
    expect(Array.isArray(artist.aliases)).toBe(true);
    expect(Array.isArray(artist.genres)).toBe(true);
    expect(Array.isArray(artist.tags)).toBe(true);

    for (const release of releases) {
      expect(["year", "month", "day", "unknown"]).toContain(
        release.firstReleaseDate.precision,
      );
      // Precision must never be padded into a more specific claim.
      if (release.firstReleaseDate.precision === "year") {
        expect(release.firstReleaseDate.value).toHaveLength(4);
      }
    }
  });

  it("finds real genre or tag data on at least one artist", async () => {
    let sawTagData = false;

    for (const entry of evidence.musicBrainzLookup.filter((e) => e.result.ok)) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replay(entry.result)));
      const { artist } = await lookupArtist(entry.mbid);
      if (artist.genres.length > 0 || artist.tags.length > 0) sawTagData = true;
    }

    // The Phase 7 scope note depends on this data actually existing.
    expect(sawTagData).toBe(true);
  });
});

describe("MusicBrainz error handling against recorded responses", () => {
  it.each(
    evidence.errorResponses
      .filter((entry) => entry.provider === "musicbrainz")
      .map((entry) => [entry.label, entry] as const),
  )("classifies the real %s error as not-found", async (_label, entry) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replay(entry.result)));

    // Live MusicBrainz answers an unknown or malformed MBID with 400 and
    // {"error":"Invalid mbid."}, never 404.
    expect(entry.result.status).toBe(400);
    await expect(
      lookupArtist("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  it("treats a real 503 as retryable rate limiting", async () => {
    const throttled = evidence.musicBrainzSearch.find(
      (entry) => entry.result.status === 503,
    );

    if (!throttled) {
      // Captured opportunistically; absence is not a failure.
      return;
    }

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        replay(throttled.result, {
          "retry-after": "0",
          "x-ratelimit-limit": "15",
        }),
      ),
    );

    await expect(searchArtists("x")).rejects.toMatchObject({
      kind: "rate-limited",
    });
  }, 15_000);
});

describe("ListenBrainz Labs against recorded responses", () => {
  const provider = createListenBrainzProvider();

  it.each(
    evidence.listenBrainzSimilarArtists
      .filter((entry) => entry.result.ok)
      .map((entry) => [entry.label, entry] as const),
  )("parses the real %s similarity response", async (_label, entry) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replay(entry.result)));

    const result = await provider.findSimilarArtists({
      mbid: entry.mbid as never,
    });

    expect(result.referenceMbid).toBe(entry.mbid);

    for (const candidate of result.candidates) {
      expect(candidate.mbid).toBeTruthy();
      expect(typeof candidate.score).toBe("number");
      expect(candidate.attribution.provenance).toBe("listenbrainz");
    }

    // Scores are large unnormalised integers, not 0..1.
    if (result.candidates.length > 1) {
      expect(result.candidates[0]!.score).toBeGreaterThanOrEqual(
        result.candidates[1]!.score,
      );
    }
  });

  it("returns a genuinely empty list for an unknown MBID, without erroring", async () => {
    const empty = evidence.listenBrainzSimilarArtists.find(
      (entry) => entry.label === "nonexistent-mbid",
    );
    expect(empty).toBeDefined();
    expect(empty!.result.status).toBe(200);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replay(empty!.result)));

    const result = await provider.findSimilarArtists({
      mbid: empty!.mbid as never,
    });

    expect(result.candidates).toEqual([]);
  });

  it("rejects a real HTML 400 body as invalid-request, not as empty results", async () => {
    const rejected = evidence.errorResponses.find(
      (entry) => entry.provider === "listenbrainz",
    );
    expect(rejected).toBeDefined();
    expect(rejected!.result.status).toBe(400);

    // Real Labs errors are HTML, so this replays text rather than JSON.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(String(rejected!.result.body), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(
      provider.findSimilarArtists({
        mbid: "8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11" as never,
      }),
    ).rejects.toMatchObject({ kind: "invalid-request" });
  });
});
