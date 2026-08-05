import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiUsageLimitError } from "@/lib/ai/limits";
import { AiProviderError } from "@/lib/ai/provider";
import { DiscoveryProviderError } from "@/lib/providers/discovery/port";
import { MusicBrainzError } from "@/lib/providers/musicbrainz/client";
import {
  asMusicBrainzId,
  type ArtistCandidate,
  type CanonicalArtist,
  type DiscographyRelease,
} from "@/types/music";

/**
 * Orchestration with every provider mocked.
 *
 * The assertions that matter most are the negative ones: what the AI layer is
 * handed, and when it is not called at all.
 */

const mocks = vi.hoisted(() => ({
  findSimilarArtists: vi.fn(),
  lookupArtist: vi.fn(),
  searchArtists: vi.fn(),
  readDismissedCandidates: vi.fn(),
  readSavedCandidates: vi.fn(),
  explainArtistMatch: vi.fn(),
  claimAiUsage: vi.fn(),
}));

vi.mock("@/lib/providers/discovery", () => ({
  getDiscoveryProvider: () => ({
    name: "listenbrainz" as const,
    findSimilarArtists: mocks.findSimilarArtists,
    findArtistsByTags: vi.fn(),
    findTracksByTags: vi.fn(),
  }),
}));

vi.mock("@/lib/providers/musicbrainz", () => ({
  getMusicBrainzClient: () => ({
    lookupArtist: mocks.lookupArtist,
    searchArtists: mocks.searchArtists,
  }),
}));

vi.mock("@/features/discovery/repository", () => ({
  readDismissedCandidates: mocks.readDismissedCandidates,
  readSavedCandidates: mocks.readSavedCandidates,
}));

vi.mock("@/lib/ai", () => ({
  getAiProvider: () => ({
    name: "gemini" as const,
    model: "test-model",
    explainArtistMatch: mocks.explainArtistMatch,
    parseMood: vi.fn(),
    answerDiscographyQuestion: vi.fn(),
    generatePlaylistTitle: vi.fn(),
    generatePlaylistDescription: vi.fn(),
  }),
}));

vi.mock("@/lib/ai/limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/limits")>()),
  claimAiUsage: mocks.claimAiUsage,
}));

const { explainCandidate, loadDiscoveryPage, DISCOVERY_PAGE_SIZE } =
  await import("@/features/discovery/service");

const attribution = {
  provenance: "musicbrainz" as const,
  sourceUrl: "https://musicbrainz.org/artist/seed",
  retrievedAt: "2026-08-05T10:00:00.000Z",
};

const seedArtist: CanonicalArtist = {
  mbid: asMusicBrainzId("11111111-1111-4111-8111-111111111111"),
  name: "Harbour Lantern",
  sortName: "Harbour Lantern",
  disambiguation: null,
  type: "Group",
  country: "GB",
  aliases: [],
  genres: ["post-rock"],
  tags: ["hazy"],
  attribution,
};

function mbidOf(index: number): string {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

function candidateAt(index: number): ArtistCandidate {
  return {
    mbid: asMusicBrainzId(mbidOf(index)),
    name: `Candidate ${index}`,
    disambiguation: null,
    type: "Group",
    score: 1000 - index * 10,
    attribution: {
      provenance: "listenbrainz",
      sourceUrl: `https://listenbrainz.org/artist/${index}`,
      retrievedAt: attribution.retrievedAt,
    },
  };
}

const releases: readonly DiscographyRelease[] = [
  {
    mbid: asMusicBrainzId("33333333-3333-4333-8333-333333333333"),
    title: "Tidal Frame",
    primaryType: "Album",
    secondaryTypes: [],
    firstReleaseDate: { value: "2011", precision: "year" },
    disambiguation: null,
    genres: [],
    tags: [],
    attribution,
  },
];

function similarityOf(count: number) {
  return {
    referenceMbid: seedArtist.mbid,
    candidates: Array.from({ length: count }, (_, index) =>
      candidateAt(index + 1),
    ),
    algorithm: "test-algorithm",
    attribution: {
      provenance: "listenbrainz" as const,
      sourceUrl: "https://listenbrainz.org/artist/seed",
      retrievedAt: attribution.retrievedAt,
    },
  };
}

const validOutput = {
  explanation: "Both are recorded under overlapping tags.",
  sharedCharacteristics: ["post-rock"],
  contrast: null,
  startingPointReleaseId: null,
  groundedIn: ["ListenBrainz ranks Candidate 1 among similar artists"],
  confidence: "medium" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readDismissedCandidates.mockResolvedValue(new Set());
  mocks.readSavedCandidates.mockResolvedValue(new Set());
  mocks.claimAiUsage.mockResolvedValue(undefined);
  mocks.lookupArtist.mockResolvedValue({ artist: seedArtist, releases });
});

describe("loadDiscoveryPage", () => {
  it("returns one page and reports that more remain", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(20));

    const result = await loadDiscoveryPage({
      seed: seedArtist,
      offset: 0,
      userId: null,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.candidates).toHaveLength(
      DISCOVERY_PAGE_SIZE,
    );
    expect(result.ok && result.value.hasMore).toBe(true);
  });

  it("removes dismissed candidates without renumbering the provider's ranks", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(5));
    mocks.readDismissedCandidates.mockResolvedValue(new Set([mbidOf(2)]));

    const result = await loadDiscoveryPage({
      seed: seedArtist,
      offset: 0,
      userId: "user-1",
    });

    const ranks = result.ok
      ? result.value.candidates.map((candidate) => candidate.rank)
      : [];

    // Rank 2 is gone; the rest keep the position the provider gave them.
    expect(ranks).toEqual([1, 3, 4, 5]);
    expect(result.ok && result.value.dismissedCount).toBe(1);
  });

  it("marks already-saved candidates", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));
    mocks.readSavedCandidates.mockResolvedValue(new Set([mbidOf(1)]));

    const result = await loadDiscoveryPage({
      seed: seedArtist,
      offset: 0,
      userId: "user-1",
    });

    expect(result.ok && result.value.candidates[0]?.saved).toBe(true);
    expect(result.ok && result.value.candidates[1]?.saved).toBe(false);
  });

  it("reads nothing per-user for an anonymous visitor", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));

    await loadDiscoveryPage({ seed: seedArtist, offset: 0, userId: null });

    expect(mocks.readDismissedCandidates).not.toHaveBeenCalled();
    expect(mocks.readSavedCandidates).not.toHaveBeenCalled();
  });

  it("surfaces a provider outage as a typed failure, not as an empty result", async () => {
    mocks.findSimilarArtists.mockRejectedValue(
      new DiscoveryProviderError("unavailable", "down"),
    );

    const result = await loadDiscoveryPage({
      seed: seedArtist,
      offset: 0,
      userId: null,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toBe("provider-unavailable");
  });

  it("distinguishes rate limiting from an outage", async () => {
    mocks.findSimilarArtists.mockRejectedValue(
      new DiscoveryProviderError("rate-limited", "slow down", 30),
    );

    const result = await loadDiscoveryPage({
      seed: seedArtist,
      offset: 0,
      userId: null,
    });

    expect(!result.ok && result.failure).toBe("rate-limited");
  });
});

describe("explainCandidate", () => {
  const seed = { artist: seedArtist, releases };

  it("sends only approved evidence to the AI provider", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));
    mocks.explainArtistMatch.mockResolvedValue(validOutput);

    await explainCandidate({
      seed,
      candidateMbid: mbidOf(1),
      listenerPreference: "slow low end",
      userId: "user-1",
    });

    const payload = mocks.explainArtistMatch.mock.calls[0]?.[0];
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toMatch(/spotify/i);
    for (const fact of payload.evidence) {
      expect(["musicbrainz", "listenbrainz"]).toContain(fact.source);
    }
    expect(payload.listenerPreference).toBe("slow low end");
  });

  it("falls back to the template when the model cites something unsupplied", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));
    mocks.explainArtistMatch.mockResolvedValue({
      ...validOutput,
      groundedIn: ["They recorded together in a Bristol studio in 1994"],
    });

    const result = await explainCandidate({
      seed,
      candidateMbid: mbidOf(1),
      listenerPreference: null,
      userId: "user-1",
    });

    expect(result.ok && result.value.status).toBe("template-rejected");
    expect(result.ok && result.value.explanation.source).toBe("template");
  });

  it("never calls the AI provider for an anonymous visitor", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));

    const result = await explainCandidate({
      seed,
      candidateMbid: mbidOf(1),
      listenerPreference: null,
      userId: null,
    });

    expect(mocks.explainArtistMatch).not.toHaveBeenCalled();
    expect(mocks.claimAiUsage).not.toHaveBeenCalled();
    expect(result.ok && result.value.status).toBe("template-anonymous");
  });

  it("reports a usage limit instead of quietly serving a fallback", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));
    mocks.claimAiUsage.mockRejectedValue(new AiUsageLimitError("daily"));

    const result = await explainCandidate({
      seed,
      candidateMbid: mbidOf(1),
      listenerPreference: null,
      userId: "user-1",
    });

    expect(mocks.explainArtistMatch).not.toHaveBeenCalled();
    expect(result.ok && result.value.status).toBe("template-limit-reached");
  });

  it("degrades to the template when the provider is unavailable", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));
    mocks.explainArtistMatch.mockRejectedValue(
      new AiProviderError("unavailable", "down"),
    );

    const result = await explainCandidate({
      seed,
      candidateMbid: mbidOf(1),
      listenerPreference: null,
      userId: "user-1",
    });

    expect(result.ok && result.value.status).toBe("template-unavailable");
    expect(result.ok && result.value.evidence.facts.length).toBeGreaterThan(0);
  });

  it("keeps working when candidate metadata cannot be retrieved", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));
    mocks.lookupArtist.mockRejectedValue(
      new MusicBrainzError("unavailable", "down"),
    );
    mocks.explainArtistMatch.mockResolvedValue(validOutput);

    const result = await explainCandidate({
      seed,
      candidateMbid: mbidOf(1),
      listenerPreference: null,
      userId: "user-1",
    });

    expect(result.ok && result.value.evidence.depth).toBe("similarity-only");
    expect(result.ok && result.value.evidence.startingPoint).toBeNull();
  });

  it("refuses a candidate that is not in the result set", async () => {
    mocks.findSimilarArtists.mockResolvedValue(similarityOf(3));

    const result = await explainCandidate({
      seed,
      candidateMbid: "99999999-9999-4999-8999-999999999999",
      listenerPreference: null,
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toBe("not-found");
    expect(mocks.explainArtistMatch).not.toHaveBeenCalled();
  });
});
