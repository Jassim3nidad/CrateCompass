import { describe, expect, it } from "vitest";

import type { DiscographyAnswer } from "@/lib/ai/schemas";
import type { SelectedContext } from "@/lib/discography/selection";
import type { TimelineEntry } from "@/lib/discography/types";
import {
  INSUFFICIENT_CONTEXT_REASON,
  verifyAnswer,
} from "@/lib/discography/verification";

/**
 * The guarantee enforced after the model answers rather than requested in a
 * prompt: every citation must name a release that was actually supplied.
 *
 * A partially-trusted answer is the failure mode to avoid. Dropping only the
 * bad citation would leave prose that may have been built on it, which is a
 * quieter version of the same problem.
 */

const SUPPLIED = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const NOT_SUPPLIED = "99999999-9999-4999-8999-999999999999";

function entry(mbid: string): TimelineEntry {
  return {
    mbid,
    title: "Dummy",
    category: "album",
    primaryType: "Album",
    secondaryTypes: [],
    firstReleaseDate: { value: "1994", precision: "year" },
    disambiguation: null,
    sourceUrl: null,
  };
}

function contextWith(
  overrides: Partial<SelectedContext> = {},
): SelectedContext {
  return {
    entries: [entry(SUPPLIED)],
    contextTruncated: false,
    retrievalComplete: true,
    totalAvailable: 1,
    criteria: [],
    ...overrides,
  };
}

function answerWith(
  overrides: Partial<DiscographyAnswer> = {},
): DiscographyAnswer {
  return {
    sufficientContext: true,
    answer: "Dummy was released in 1994.",
    citedReleaseIds: [SUPPLIED],
    unansweredReason: null,
    ...overrides,
  };
}

describe("grounded answers", () => {
  it("accepts an answer citing a supplied release", () => {
    const result = verifyAnswer({
      answer: answerWith(),
      context: contextWith(),
    });

    expect(result.status).toBe("answered");
    expect(result.status === "answered" && result.citations).toHaveLength(1);
  });

  it("matches an identifier case-insensitively", () => {
    const result = verifyAnswer({
      answer: answerWith({ citedReleaseIds: [SUPPLIED.toUpperCase()] }),
      context: contextWith(),
    });

    expect(result.status).toBe("answered");
  });

  it("does not repeat a release cited twice", () => {
    const result = verifyAnswer({
      answer: answerWith({ citedReleaseIds: [SUPPLIED, SUPPLIED] }),
      context: contextWith(),
    });

    expect(result.status === "answered" && result.citations).toHaveLength(1);
  });

  it("accepts an answer that cites nothing", () => {
    // Not every factual answer needs a citation, and requiring one would push
    // the model into inventing them.
    const result = verifyAnswer({
      answer: answerWith({ citedReleaseIds: [] }),
      context: contextWith(),
    });

    expect(result.status).toBe("answered");
  });
});

describe("discarded answers", () => {
  it("discards an answer citing a release that was never supplied", () => {
    const result = verifyAnswer({
      answer: answerWith({ citedReleaseIds: [NOT_SUPPLIED] }),
      context: contextWith(),
    });

    expect(result.status).toBe("insufficient-context");
    expect(result.status === "insufficient-context" && result.reason).toBe(
      INSUFFICIENT_CONTEXT_REASON,
    );
  });

  it("discards the whole answer when only one citation is bad", () => {
    // The prose may have been built on the invented release, so keeping the
    // good half would be trusting something that failed its own check.
    const result = verifyAnswer({
      answer: answerWith({ citedReleaseIds: [SUPPLIED, NOT_SUPPLIED] }),
      context: contextWith(),
    });

    expect(result.status).toBe("insufficient-context");
  });

  it("discards an empty answer that claims sufficient context", () => {
    const result = verifyAnswer({
      answer: answerWith({ answer: "   " }),
      context: contextWith(),
    });

    expect(result.status).toBe("insufficient-context");
  });
});

describe("honest limitation", () => {
  it("prefers the model's own reason when it gave one", () => {
    const result = verifyAnswer({
      answer: answerWith({
        sufficientContext: false,
        unansweredReason: "No live albums are recorded for this artist.",
      }),
      context: contextWith(),
    });

    expect(result.status === "insufficient-context" && result.reason).toBe(
      "No live albums are recorded for this artist.",
    );
  });

  it("falls back to the deterministic sentence when no reason was given", () => {
    const result = verifyAnswer({
      answer: answerWith({ sufficientContext: false, unansweredReason: null }),
      context: contextWith(),
    });

    expect(result.status === "insufficient-context" && result.reason).toBe(
      INSUFFICIENT_CONTEXT_REASON,
    );
  });
});

describe("provenance travels with every outcome", () => {
  it("carries both signals on an answered result", () => {
    const result = verifyAnswer({
      answer: answerWith(),
      context: contextWith({
        contextTruncated: true,
        retrievalComplete: false,
        totalAvailable: 573,
      }),
    });

    expect(result.contextTruncated).toBe(true);
    expect(result.retrievalComplete).toBe(false);
    expect(result.totalAvailable).toBe(573);
    expect(result.consultedCount).toBe(1);
  });

  it("carries both signals on a discarded result", () => {
    // A degraded answer that loses its provenance on the way out is the silent
    // truncation defect wearing a different hat.
    const result = verifyAnswer({
      answer: answerWith({ citedReleaseIds: [NOT_SUPPLIED] }),
      context: contextWith({ contextTruncated: true, totalAvailable: 573 }),
    });

    expect(result.contextTruncated).toBe(true);
    expect(result.totalAvailable).toBe(573);
  });
});
