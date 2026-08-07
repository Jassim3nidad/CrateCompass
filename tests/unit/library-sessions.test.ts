import { describe, expect, it } from "vitest";

import {
  HISTORY_TRACKING_STARTED_AT,
  predatesHistoryTracking,
} from "@/lib/library/sessions";

/**
 * The empty state's whole job.
 *
 * A brand-new account and an account older than this feature both show an empty
 * history page. "No history yet" is true for the first and misleading for the
 * second — it implies nothing happened, when the truth is that nothing was
 * recorded. This predicate is what keeps the two apart.
 *
 * Nothing is backfilled to close that gap, so the distinction is the only
 * honest thing the page can offer.
 */

describe("accounts older than history tracking", () => {
  it("recognises an account created before recording began", () => {
    expect(predatesHistoryTracking("2026-08-01T00:00:00.000Z")).toBe(true);
  });

  it("does not claim a brand-new account predates tracking", () => {
    expect(predatesHistoryTracking("2026-09-01T00:00:00.000Z")).toBe(false);
  });

  it("treats an account created exactly at the boundary as covered", () => {
    // The boundary belongs to the tracked side: an account created the moment
    // recording began had everything after it recorded.
    expect(predatesHistoryTracking(HISTORY_TRACKING_STARTED_AT)).toBe(false);
  });

  it.each([undefined, "", "not a date"])(
    "falls back to the ordinary empty state for %s",
    (value) => {
      // An unreadable timestamp must not produce an explanation about history
      // predating the feature, which might well be untrue.
      expect(predatesHistoryTracking(value)).toBe(false);
    },
  );

  it("has a tracking start date that parses", () => {
    expect(Number.isFinite(Date.parse(HISTORY_TRACKING_STARTED_AT))).toBe(true);
  });
});
