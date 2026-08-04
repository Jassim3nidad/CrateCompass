import { describe, expect, it } from "vitest";

import {
  AiBoundaryViolationError,
  assertAiSafe,
  isAiSafe,
} from "@/lib/ai/input-guard";

/**
 * Phase 3 portion of the Spotify-to-AI boundary. Phase 5 replaces this with a
 * full gateway; these cases must keep passing when it does.
 */

const acceptableInput = {
  mood: "late-night driving, warm and unhurried",
  criteria: {
    energyLevel: "low",
    genreHints: ["ambient", "dub techno"],
  },
  evidence: [
    { artist: "Example Artist", source: "musicbrainz", score: 0.82 },
    { artist: "Another Artist", source: "lastfm", score: 0.44 },
  ],
};

describe("approved AI input", () => {
  it("passes user text, taxonomy, and non-Spotify evidence through unchanged", () => {
    expect(assertAiSafe(acceptableInput)).toBe(acceptableInput);
    expect(isAiSafe(acceptableInput)).toBe(true);
  });

  it("accepts an ordinary non-Spotify URL", () => {
    expect(isAiSafe({ source: "https://musicbrainz.org/artist/abc" })).toBe(
      true,
    );
  });
});

describe("forbidden keys", () => {
  const forbidden = [
    "spotify",
    "spotifyId",
    "spotify_uri",
    "external_urls",
    "href",
    "images",
    "access_token",
    "refresh_token",
    "snapshot_id",
    "authorization",
    "code_verifier",
  ];

  it.each(forbidden)("rejects a top-level %s key", (key) => {
    expect(() => assertAiSafe({ [key]: "value" })).toThrow(
      AiBoundaryViolationError,
    );
  });

  it("rejects a forbidden key nested several levels deep", () => {
    const nested = {
      criteria: { seed: { candidates: [{ meta: { spotifyId: "abc123" } }] } },
    };

    try {
      assertAiSafe(nested);
      expect.unreachable("nested Spotify key should have been rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AiBoundaryViolationError);
      expect((error as AiBoundaryViolationError).reason).toBe("forbidden-key");
      expect((error as AiBoundaryViolationError).path).toBe(
        "criteria.seed.candidates[0].meta.spotifyId",
      );
    }
  });
});

describe("forbidden values", () => {
  it("rejects a Spotify URI anywhere in a string", () => {
    expect(() =>
      assertAiSafe({
        note: "the track is spotify:track:4uLU6hMCjMI75M1A2tKUQC",
      }),
    ).toThrow(/spotify-uri/);
  });

  it.each([
    "https://open.spotify.com/artist/abc",
    "https://api.spotify.com/v1/me",
    "https://i.scdn.co/image/abc",
  ])("rejects the Spotify-controlled host in %s", (value) => {
    expect(() => assertAiSafe({ artwork: value })).toThrow(/spotify-host/);
  });

  it("rejects credential-shaped strings", () => {
    expect(() => assertAiSafe({ note: "Bearer BQAbc123def" })).toThrow(
      /credential/,
    );
  });

  it("rejects a Spotify host hidden in an array element", () => {
    expect(
      isAiSafe({ sources: ["musicbrainz.org", "open.spotify.com/x"] }),
    ).toBe(false);
  });
});

describe("provenance enforcement", () => {
  it("accepts evidence from sources whose terms permit AI processing", () => {
    for (const provenance of [
      "musicbrainz",
      "listenbrainz",
      "user",
      "application",
    ]) {
      expect(isAiSafe({ fact: "x", provenance })).toBe(true);
    }
  });

  it("rejects Spotify-derived evidence on provenance alone", () => {
    // No Spotify key, URI, or host appears anywhere: provenance is the only
    // signal, and it must be enough.
    const evidence = { artistName: "Example Artist", provenance: "spotify" };

    try {
      assertAiSafe(evidence);
      expect.unreachable("Spotify provenance should have been rejected");
    } catch (error) {
      expect((error as AiBoundaryViolationError).reason).toBe(
        "unapproved-provenance",
      );
    }
  });

  it("rejects an unknown provenance rather than defaulting to allowed", () => {
    expect(isAiSafe({ fact: "x", provenance: "some-new-provider" })).toBe(
      false,
    );
  });

  it("finds unapproved provenance nested inside a candidate list", () => {
    const payload = {
      criteria: { mood: "late night" },
      candidates: [
        { name: "Approved", provenance: "listenbrainz" },
        { name: "Leaked", provenance: "spotify" },
      ],
    };

    try {
      assertAiSafe(payload);
      expect.unreachable("nested Spotify provenance should have been rejected");
    } catch (error) {
      expect((error as AiBoundaryViolationError).path).toBe(
        "candidates[1].provenance",
      );
    }
  });
});

describe("input limits", () => {
  it("rejects oversized input", () => {
    expect(() => assertAiSafe({ mood: "a".repeat(60_001) })).toThrow(
      /too-large/,
    );
  });

  it("rejects values it cannot reason about", () => {
    expect(() => assertAiSafe({ callback: () => undefined })).toThrow(
      AiBoundaryViolationError,
    );
  });

  it("never echoes the offending value in the error message", () => {
    const secret = "spotify:track:supersecretidentifier";

    try {
      assertAiSafe({ note: secret });
      expect.unreachable("should have been rejected");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
