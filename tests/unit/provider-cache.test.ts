import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTtlCache } from "@/lib/providers/cache";
import {
  createListenBrainzProvider,
  clearSimilarityCacheForTesting,
} from "@/lib/providers/discovery/listenbrainz";
import {
  clearMusicBrainzCachesForTesting,
  searchArtists,
} from "@/lib/providers/musicbrainz/client";
import { resetPacerForTesting } from "@/lib/providers/musicbrainz/pacer";
import { asMusicBrainzId } from "@/types/music";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetPacerForTesting();
  clearMusicBrainzCachesForTesting();
  clearSimilarityCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TTL cache", () => {
  it("serves a repeat read without invoking the loader", async () => {
    const cache = createTtlCache<number>({ name: "test", ttlMs: 60_000 });
    const loader = vi.fn().mockResolvedValue(42);

    expect(await cache.read("k", loader)).toBe(42);
    expect(await cache.read("k", loader)).toBe(42);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct keys separate", async () => {
    const cache = createTtlCache<string>({ name: "test", ttlMs: 60_000 });
    const loader = vi.fn().mockImplementation(() => Promise.resolve("v"));

    await cache.read("a", loader);
    await cache.read("b", loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("reloads once the entry expires", async () => {
    const cache = createTtlCache<number>({ name: "test", ttlMs: 10 });
    const loader = vi.fn().mockResolvedValue(1);

    await cache.read("k", loader);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await cache.read("k", loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("never caches a failure", async () => {
    const cache = createTtlCache<string>({ name: "test", ttlMs: 60_000 });
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.read("k", loader)).rejects.toThrow("provider down");
    // A transient outage must not be pinned in front of a working provider.
    await expect(cache.read("k", loader)).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const cache = createTtlCache<number>({ name: "test", ttlMs: 60_000 });
    const loader = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(7), 20)),
      );

    const results = await Promise.all([
      cache.read("k", loader),
      cache.read("k", loader),
      cache.read("k", loader),
    ]);

    expect(results).toEqual([7, 7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest entry past the size bound", async () => {
    const cache = createTtlCache<number>({
      name: "test",
      ttlMs: 60_000,
      maxEntries: 2,
    });

    await cache.read("a", () => Promise.resolve(1));
    await cache.read("b", () => Promise.resolve(2));
    await cache.read("c", () => Promise.resolve(3));

    expect(cache.size).toBeLessThanOrEqual(2);
  });
});

describe("MusicBrainz caching", () => {
  it("does not hit the network for an identical repeat search", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ artists: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchArtists("portishead");
    await searchArtists("portishead");
    await searchArtists("portishead");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a different limit as a different request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ artists: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchArtists("portishead", { limit: 5 });
    await searchArtists("portishead", { limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe("ListenBrainz caching", () => {
  it("does not hit the network for an identical repeat lookup", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createListenBrainzProvider();
    const mbid = asMusicBrainzId("8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11");

    await provider.findSimilarArtists({ mbid });
    await provider.findSimilarArtists({ mbid });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not serve a cached result to a different limit", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createListenBrainzProvider();
    const mbid = asMusicBrainzId("8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11");

    await provider.findSimilarArtists({ mbid, limit: 5 });
    await provider.findSimilarArtists({ mbid, limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
