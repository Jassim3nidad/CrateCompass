import { describe, expect, it } from "vitest";

import { getSafeReturnPath } from "@/lib/security/safe-redirect";

describe("safe return paths", () => {
  it("keeps local paths with query and hash", () => {
    expect(getSafeReturnPath("/discover?q=jazz#results")).toBe(
      "/discover?q=jazz#results",
    );
  });

  it.each([
    "https://example.com",
    "//example.com",
    "javascript:alert(1)",
    null,
  ])("rejects unsafe return value %s", (candidate) => {
    expect(getSafeReturnPath(candidate)).toBe("/discover");
  });
});
