import { describe, expect, it } from "vitest";

import type { DiscoveryExplanation } from "@/lib/discovery/types";
import {
  EXPLANATION_SNAPSHOT_VERSION,
  readStoredExplanation,
  toExplanationColumns,
} from "@/lib/library/explanation-snapshot";

/**
 * A saved explanation is a snapshot, and these tests pin the two properties
 * that make it honest: it stores what was on screen, and it never claims an
 * attribution it does not have.
 */

function explanationWith(
  overrides: Partial<DiscoveryExplanation> = {},
): DiscoveryExplanation {
  return {
    source: "ai",
    summary: "Shares a hazy low end and unhurried tempo.",
    sharedCharacteristics: ["trip hop", "downtempo"],
    contrast: "Warmer production than the seed.",
    startingPoint: {
      releaseId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      title: "Dummy",
      year: "1994",
      primaryType: "Album",
      sourceUrl: "https://musicbrainz.org/release-group/1a2b",
    },
    groundedIn: ["ListenBrainz reports a similarity score of 0.82."],
    confidence: "medium",
    model: "gemini-2.5-flash",
    ...overrides,
  };
}

describe("freezing an explanation", () => {
  it("stores the prose and the starting point that were on screen", () => {
    const columns = toExplanationColumns({
      explanation: explanationWith(),
      provider: "gemini",
    });

    expect(columns.explanation.summary).toContain("hazy low end");
    expect(columns.explanation.sharedCharacteristics).toEqual([
      "trip hop",
      "downtempo",
    ]);
    expect(columns.explanation.startingPoint?.title).toBe("Dummy");
  });

  it("does not store the verification trace", () => {
    // groundedIn did its job before the explanation was ever displayed.
    // Keeping it would invite re-verification against evidence that is gone.
    const columns = toExplanationColumns({
      explanation: explanationWith(),
      provider: "gemini",
    });

    expect(JSON.stringify(columns.explanation)).not.toContain("ListenBrainz");
    expect(columns.explanation).not.toHaveProperty("groundedIn");
  });

  it("stamps the current version", () => {
    expect(
      toExplanationColumns({
        explanation: explanationWith(),
        provider: "gemini",
      }).explanation_version,
    ).toBe(EXPLANATION_SNAPSHOT_VERSION);
  });

  it("attributes an AI explanation to its provider and model", () => {
    const columns = toExplanationColumns({
      explanation: explanationWith(),
      provider: "gemini",
    });

    expect(columns.explanation_source).toBe("ai");
    expect(columns.explanation_provider).toBe("gemini");
    expect(columns.explanation_model).toBe("gemini-2.5-flash");
  });

  it("claims no provider for a deterministic template", () => {
    // The database check constraint requires a provider for an AI explanation
    // and a template has none to name, so inventing one would fail the insert.
    const columns = toExplanationColumns({
      explanation: explanationWith({ source: "template", model: null }),
      provider: "gemini",
    });

    expect(columns.explanation_source).toBe("template");
    expect(columns.explanation_provider).toBeNull();
    expect(columns.explanation_model).toBeNull();
  });
});

describe("reading a stored explanation", () => {
  const stored = toExplanationColumns({
    explanation: explanationWith(),
    provider: "gemini",
  });

  it("round-trips what was written", () => {
    const read = readStoredExplanation({
      explanation: stored.explanation,
      explanation_version: stored.explanation_version,
      explanation_source: stored.explanation_source,
      explanation_provider: stored.explanation_provider,
      explanation_model: stored.explanation_model,
    });

    expect(read?.snapshot.summary).toBe(stored.explanation.summary);
    expect(read?.source).toBe("ai");
    expect(read?.versionMismatch).toBe(false);
  });

  it("returns null when there is no snapshot", () => {
    expect(
      readStoredExplanation({
        explanation: null,
        explanation_version: null,
        explanation_source: null,
        explanation_provider: null,
        explanation_model: null,
      }),
    ).toBeNull();
  });

  it("renders an unrecognised version rather than failing", () => {
    // A library that breaks on an old favourite is worse than one showing a
    // partial explanation, so a version bump must not take the page down.
    const read = readStoredExplanation({
      explanation: stored.explanation,
      explanation_version: 99,
      explanation_source: "ai",
      explanation_provider: "gemini",
      explanation_model: "gemini-2.5-flash",
    });

    expect(read).not.toBeNull();
    expect(read?.versionMismatch).toBe(true);
    expect(read?.snapshot.summary).toBe(stored.explanation.summary);
  });

  it("returns null for a snapshot that does not match the shape", () => {
    expect(
      readStoredExplanation({
        explanation: { unexpected: true },
        explanation_version: 1,
        explanation_source: "ai",
        explanation_provider: "gemini",
        explanation_model: null,
      }),
    ).toBeNull();
  });

  it("treats an unknown source as a template rather than claiming AI", () => {
    const read = readStoredExplanation({
      explanation: stored.explanation,
      explanation_version: 1,
      explanation_source: "something-else",
      explanation_provider: null,
      explanation_model: null,
    });

    expect(read?.source).toBe("template");
  });
});
