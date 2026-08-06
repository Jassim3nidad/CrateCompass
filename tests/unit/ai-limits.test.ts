import { describe, expect, it } from "vitest";

import { AI_LIMITS, perMinuteLimitFor } from "@/lib/ai/limits";

/**
 * Per-operation burst tolerance.
 *
 * The daily cap is what bounds spend and does not move. The per-minute window
 * exists to stop runaway loops, and a Q&A panel where three follow-ups is
 * ordinary is not a runaway loop, so that operation states a wider tolerance.
 */

describe("per-minute limit", () => {
  it("uses the default for an operation with no override", () => {
    expect(perMinuteLimitFor("parseMood")).toBe(AI_LIMITS.perUserPerMinute);
    expect(perMinuteLimitFor("explainArtistMatch")).toBe(
      AI_LIMITS.perUserPerMinute,
    );
  });

  it("allows a wider burst for discography questions", () => {
    expect(perMinuteLimitFor("answerDiscographyQuestion")).toBe(10);
  });

  it("raises the burst window without raising the daily cap", () => {
    // The cost decision: more questions in a minute, not more questions a day.
    expect(perMinuteLimitFor("answerDiscographyQuestion")).toBeGreaterThan(
      AI_LIMITS.perUserPerMinute,
    );
    expect(AI_LIMITS.perUserPerDay).toBe(20);
  });

  it("uses the default for an unknown operation name", () => {
    // A typo in a call site must not silently hand out a wider allowance.
    expect(perMinuteLimitFor("answerDiscographyQuestions")).toBe(
      AI_LIMITS.perUserPerMinute,
    );
    expect(perMinuteLimitFor("")).toBe(AI_LIMITS.perUserPerMinute);
  });

  it("is not fooled by inherited object properties", () => {
    // A plain-object lookup would return a function for "constructor".
    expect(perMinuteLimitFor("constructor")).toBe(AI_LIMITS.perUserPerMinute);
    expect(perMinuteLimitFor("toString")).toBe(AI_LIMITS.perUserPerMinute);
  });
});
