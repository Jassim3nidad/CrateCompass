import { describe, expect, it } from "vitest";

import {
  buildMatchEvidence,
  classifyStrength,
  selectStartingPoint,
} from "@/lib/discovery/evidence";
import { AI_APPROVED_PROVENANCE } from "@/types/music";
import {
  asMusicBrainzId,
  type ArtistCandidate,
  type CanonicalArtist,
  type DiscographyRelease,
  type SourceAttribution,
} from "@/types/music";

/**
 * Evidence is the load-bearing part of the discovery feature: it is what the
 * UI shows as traceable, and it is the only material the AI layer receives.
 * These tests hold it to both jobs.
 */

const retrievedAt = "2026-08-05T10:00:00.000Z";

function attribution(
  provenance: "musicbrainz" | "listenbrainz",
): SourceAttribution {
  return {
    provenance,
    sourceUrl: `https://example.invalid/${provenance}`,
    retrievedAt,
  };
}

function artist(overrides: Partial<CanonicalArtist> = {}): CanonicalArtist {
  return {
    mbid: asMusicBrainzId("11111111-1111-4111-8111-111111111111"),
    name: "Harbour Lantern",
    sortName: "Harbour Lantern",
    disambiguation: null,
    type: "Group",
    country: "GB",
    aliases: [],
    genres: ["post-rock"],
    tags: ["hazy"],
    attribution: attribution("musicbrainz"),
    ...overrides,
  };
}

function candidate(overrides: Partial<ArtistCandidate> = {}): ArtistCandidate {
  return {
    mbid: asMusicBrainzId("22222222-2222-4222-8222-222222222222"),
    name: "Vellum Coast",
    disambiguation: null,
    type: "Group",
    score: 500,
    attribution: attribution("listenbrainz"),
    ...overrides,
  };
}

function release(
  overrides: Partial<DiscographyRelease> = {},
): DiscographyRelease {
  return {
    mbid: asMusicBrainzId("33333333-3333-4333-8333-333333333333"),
    title: "Tidal Frame",
    primaryType: "Album",
    secondaryTypes: [],
    firstReleaseDate: { value: "2011-05-16", precision: "day" },
    disambiguation: null,
    genres: [],
    tags: [],
    attribution: attribution("musicbrainz"),
    ...overrides,
  };
}

describe("strength buckets", () => {
  it("describes position within the result set, not absolute quality", () => {
    expect(classifyStrength(1)).toBe("strong");
    expect(classifyStrength(0.5)).toBe("strong");
    expect(classifyStrength(0.49)).toBe("moderate");
    expect(classifyStrength(0.2)).toBe("moderate");
    expect(classifyStrength(0.19)).toBe("emerging");
    expect(classifyStrength(0)).toBe("emerging");
  });
});

describe("starting point selection", () => {
  it("picks the earliest studio album", () => {
    const point = selectStartingPoint([
      release({
        mbid: asMusicBrainzId("aaaaaaaa-0000-4000-8000-000000000001"),
        title: "Long Ferry",
        firstReleaseDate: { value: "2015-09-04", precision: "day" },
      }),
      release(),
    ]);

    expect(point?.title).toBe("Tidal Frame");
    expect(point?.year).toBe("2011");
  });

  it("ignores live and compilation releases", () => {
    const point = selectStartingPoint([
      release({
        title: "Live at the Dry Dock",
        secondaryTypes: ["Live"],
        firstReleaseDate: { value: "2008", precision: "year" },
      }),
      release({
        title: "Odds and Ends",
        primaryType: "Album",
        secondaryTypes: ["Compilation"],
        firstReleaseDate: { value: "2009", precision: "year" },
      }),
      release(),
    ]);

    expect(point?.title).toBe("Tidal Frame");
  });

  it("returns nothing rather than substituting a weaker release", () => {
    expect(
      selectStartingPoint([
        release({ primaryType: "Single", secondaryTypes: [] }),
        release({
          primaryType: "Album",
          firstReleaseDate: { value: null, precision: "unknown" },
        }),
      ]),
    ).toBeNull();
  });
});

describe("match evidence", () => {
  const base = {
    seed: artist(),
    candidate: candidate(),
    candidateArtist: artist({
      mbid: asMusicBrainzId("22222222-2222-4222-8222-222222222222"),
      name: "Vellum Coast",
      genres: ["post-rock", "shoegaze"],
      tags: ["hazy", "reverb-heavy"],
    }),
    candidateReleases: [release()],
    rank: 2,
    totalCandidates: 25,
    topScore: 1000,
    similarityAttribution: attribution("listenbrainz"),
  };

  it("separates shared tags from tags only the candidate carries", () => {
    const evidence = buildMatchEvidence(base);

    expect(evidence.sharedTags).toEqual(["post-rock", "hazy"]);
    expect(evidence.candidateOnlyTags).toEqual(["shoegaze", "reverb-heavy"]);
  });

  it("reports the relative score rather than inventing a match percentage", () => {
    const evidence = buildMatchEvidence(base);

    expect(evidence.relativeScore).toBe(50);
    expect(evidence.strength).toBe("strong");
  });

  it("only produces facts from AI-approved sources", () => {
    const evidence = buildMatchEvidence(base);

    for (const fact of evidence.facts) {
      expect(AI_APPROVED_PROVENANCE).toContain(fact.source);
    }
  });

  it("never emits a Spotify-shaped string", () => {
    const serialized = JSON.stringify(buildMatchEvidence(base));

    expect(serialized).not.toMatch(/spotify/i);
    expect(serialized).not.toMatch(/scdn\.co/i);
  });

  it("stays within the twelve facts the AI schema accepts", () => {
    const evidence = buildMatchEvidence({
      ...base,
      candidateArtist: artist({
        genres: Array.from({ length: 20 }, (_, index) => `genre-${index}`),
        tags: Array.from({ length: 20 }, (_, index) => `tag-${index}`),
      }),
    });

    expect(evidence.facts.length).toBeLessThanOrEqual(12);
  });

  it("marks a failed metadata lookup as similarity-only rather than empty", () => {
    const evidence = buildMatchEvidence({
      ...base,
      candidateArtist: null,
      candidateReleases: [],
    });

    expect(evidence.depth).toBe("similarity-only");
    expect(evidence.sharedTags).toEqual([]);
    // The relationship is still known, so there is still one fact to show.
    expect(evidence.facts).toHaveLength(1);
    expect(evidence.facts[0]?.source).toBe("listenbrainz");
  });

  it("does not claim a shared type or country when they differ", () => {
    const evidence = buildMatchEvidence({
      ...base,
      candidateArtist: artist({ type: "Person", country: "IE" }),
    });

    expect(evidence.sharedType).toBeNull();
    expect(evidence.sharedCountry).toBeNull();
  });

  it("is reproducible from its inputs", () => {
    expect(buildMatchEvidence(base).facts).toEqual(
      buildMatchEvidence(base).facts,
    );
  });
});
