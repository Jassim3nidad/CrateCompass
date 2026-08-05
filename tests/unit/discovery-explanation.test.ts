import { describe, expect, it } from "vitest";

import type { ArtistMatchExplanation } from "@/lib/ai/schemas";
import {
  buildTemplateExplanation,
  claimSupport,
  verifyExplanation,
} from "@/lib/discovery/explanation";
import type { MatchEvidence, StartingPoint } from "@/lib/discovery/types";

/**
 * The verification step is the difference between "the prompt asked the model
 * not to make things up" and "an explanation that made something up cannot
 * reach the listener". These tests exercise the second.
 */

const evidence: MatchEvidence = {
  rank: 2,
  totalCandidates: 25,
  strength: "strong",
  relativeScore: 62,
  sharedTags: ["post-rock", "hazy"],
  candidateOnlyTags: ["shoegaze"],
  sharedType: "Group",
  sharedCountry: "GB",
  startingPoint: null,
  depth: "full",
  facts: [
    {
      source: "listenbrainz",
      statement:
        "ListenBrainz ranks Vellum Coast #2 of 25 similar artists for Harbour Lantern, at 62% of the strongest similarity score in this result set.",
    },
    {
      source: "musicbrainz",
      statement:
        "MusicBrainz records both Harbour Lantern and Vellum Coast under the tags: post-rock, hazy.",
    },
  ],
  attributions: [],
};

const allowedReleases: readonly StartingPoint[] = [
  {
    releaseId: "rg-1",
    title: "Tidal Frame",
    year: "2011",
    primaryType: "Album",
    sourceUrl: "https://musicbrainz.org/release-group/rg-1",
  },
];

function output(
  overrides: Partial<ArtistMatchExplanation> = {},
): ArtistMatchExplanation {
  return {
    explanation: "Both are recorded under overlapping tags.",
    sharedCharacteristics: ["post-rock"],
    contrast: "Vellum Coast also carries shoegaze tags.",
    startingPointReleaseId: null,
    groundedIn: ["MusicBrainz records both under the tags post-rock and hazy"],
    confidence: "medium",
    ...overrides,
  };
}

describe("claim support", () => {
  it("scores a paraphrase of a supplied fact as supported", () => {
    expect(
      claimSupport(
        "MusicBrainz records both under the tags post-rock and hazy",
        evidence.facts[1]!.statement,
      ),
    ).toBeGreaterThanOrEqual(0.5);
  });

  it("scores an unrelated claim as unsupported", () => {
    expect(
      claimSupport(
        "They toured together across Europe in 2018",
        evidence.facts[1]!.statement,
      ),
    ).toBeLessThan(0.5);
  });
});

describe("explanation verification", () => {
  it("accepts an explanation whose claims trace to supplied facts", () => {
    const result = verifyExplanation({
      output: output(),
      evidence,
      allowedReleases,
      model: "test-model",
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.explanation.source).toBe("ai");
    expect(result.ok && result.explanation.model).toBe("test-model");
  });

  it("rejects an explanation grounded in something never supplied", () => {
    const result = verifyExplanation({
      output: output({
        groundedIn: ["The two bands share a producer and a studio"],
      }),
      evidence,
      allowedReleases,
      model: "test-model",
    });

    expect(result).toEqual({ ok: false, reason: "ungrounded-claim" });
  });

  it("rejects a starting point that was never supplied", () => {
    const result = verifyExplanation({
      output: output({ startingPointReleaseId: "rg-invented" }),
      evidence,
      allowedReleases,
      model: "test-model",
    });

    expect(result).toEqual({ ok: false, reason: "unknown-release" });
  });

  it("resolves a supplied starting point to its MusicBrainz record", () => {
    const result = verifyExplanation({
      output: output({ startingPointReleaseId: "rg-1" }),
      evidence,
      allowedReleases,
      model: "test-model",
    });

    expect(result.ok && result.explanation.startingPoint?.title).toBe(
      "Tidal Frame",
    );
  });

  it("rejects output that mentions Spotify, which no input could have supplied", () => {
    const result = verifyExplanation({
      output: output({
        explanation: "Both appear on the same Spotify editorial playlist.",
      }),
      evidence,
      allowedReleases,
      model: "test-model",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden-content" });
  });
});

describe("template explanation", () => {
  it("states the reported relationship without characterising the music", () => {
    const template = buildTemplateExplanation({
      seedName: "Harbour Lantern",
      candidateName: "Vellum Coast",
      evidence,
    });

    expect(template.source).toBe("template");
    expect(template.confidence).toBe("low");
    expect(template.summary).toContain("#2 of 25");
    expect(template.summary).toContain("not how the music sounds");
    expect(template.contrast).toContain("shoegaze");
  });

  it("says so plainly when metadata could not be retrieved", () => {
    const template = buildTemplateExplanation({
      seedName: "Harbour Lantern",
      candidateName: "Vellum Coast",
      evidence: {
        ...evidence,
        sharedTags: [],
        candidateOnlyTags: [],
        depth: "similarity-only",
      },
    });

    expect(template.summary).toContain("could not be retrieved");
    expect(template.contrast).toBeNull();
  });

  it("distinguishes no shared tags from unavailable tags", () => {
    const template = buildTemplateExplanation({
      seedName: "Harbour Lantern",
      candidateName: "Vellum Coast",
      evidence: { ...evidence, sharedTags: [], depth: "full" },
    });

    expect(template.summary).toContain("no tags shared");
  });
});
