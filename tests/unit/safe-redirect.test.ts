import { describe, expect, it } from "vitest";

import { getSafeReturnPath } from "@/lib/security/safe-redirect";

/**
 * The guard's contract, tested at both ends.
 *
 * The rejection cases below are not a list of strings someone thought of. Two
 * of them — the normalising ones — were accepted by the original
 * implementation and were a live open redirect on sign-in and sign-up
 * (Phase 11, SEC-01). The suite passed the whole time, because it asserted the
 * inputs that had been imagined rather than the property that matters.
 *
 * The property: no output of this function, resolved against any base URL, may
 * leave the origin. That is what `resolvesToOrigin` asserts, and it is the
 * assertion that would have caught SEC-01.
 */

const BASE = "https://cratecompass.example/auth/sign-in";

function resolve(candidate: string | null | undefined): string {
  return new URL(getSafeReturnPath(candidate), BASE).toString();
}

describe("safe return paths", () => {
  it("keeps local paths with query and hash", () => {
    expect(getSafeReturnPath("/discover?q=jazz#results")).toBe(
      "/discover?q=jazz#results",
    );
  });

  it("keeps a plain path unchanged", () => {
    expect(getSafeReturnPath("/library")).toBe("/library");
  });

  it.each([
    "https://example.com",
    "//example.com",
    "javascript:alert(1)",
    "",
    null,
    undefined,
  ])("rejects unsafe return value %s", (candidate) => {
    expect(getSafeReturnPath(candidate)).toBe("/discover");
  });

  it.each([
    // Every one of these normalises to "//example.com" inside the URL parser.
    // The input check never sees a leading "//", so only an output check
    // rejects them. These are the SEC-01 regression cases.
    "/..//example.com",
    "/../..//example.com",
    "/a/..//example.com",
    "/./..//example.com",
    "/%2e%2e//example.com",
    "/a/b/../..//example.com",
  ])(
    "rejects %s, which normalises to a protocol-relative path",
    (candidate) => {
      expect(getSafeReturnPath(candidate)).toBe("/discover");
    },
  );

  it("honours a caller-supplied fallback when rejecting", () => {
    expect(getSafeReturnPath("/..//example.com", "/settings/connections")).toBe(
      "/settings/connections",
    );
  });

  it.each([
    "/discover",
    "/library?q=x#y",
    "//example.com",
    "/..//example.com",
    "/a/..//example.com",
    "/%2e%2e//example.com",
    "https://example.com",
    "javascript:alert(1)",
    "/\\example.com",
    null,
  ])("never resolves off-origin, whatever is passed: %s", (candidate) => {
    // The real invariant. `getSafeReturnPath` is only safe in combination
    // with how callers use its result, so the assertion is on the resolved
    // absolute URL rather than on the returned string.
    expect(resolve(candidate)).toMatch(/^https:\/\/cratecompass\.example\//);
  });
});
