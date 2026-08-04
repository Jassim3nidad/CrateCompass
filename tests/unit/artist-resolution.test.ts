import { describe, expect, it } from "vitest";

import {
  matchesCanonicalArtist,
  normalizeArtistName,
  resolveSpotifyArtist,
} from "@/lib/matching/artist-resolution";
import { asMusicBrainzId, type CanonicalArtist } from "@/types/music";

function canonical(
  name: string,
  aliases: readonly string[] = [],
): CanonicalArtist {
  return {
    mbid: asMusicBrainzId("8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11"),
    name,
    sortName: name,
    disambiguation: null,
    type: "Group",
    country: "GB",
    aliases: aliases.map((alias) => ({
      name: alias,
      sortName: null,
      locale: null,
      primary: false,
    })),
    genres: [],
    tags: [],
    attribution: {
      provenance: "musicbrainz",
      sourceUrl: null,
      retrievedAt: "2026-08-04T00:00:00.000Z",
    },
  };
}

describe("name normalisation", () => {
  it.each([
    ["Björk", "bjork"],
    ["BJORK", "bjork"],
    ["The Beatles", "beatles"],
    ["Godspeed You! Black Emperor", "godspeed you black emperor"],
    ["Simon & Garfunkel", "simon and garfunkel"],
    ["  Portishead  ", "portishead"],
    ["A Tribe Called Quest", "tribe called quest"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeArtistName(input)).toBe(expected);
  });

  it("treats punctuation variants as the same name", () => {
    expect(normalizeArtistName("Sunn O)))")).toBe(
      normalizeArtistName("Sunn O)))"),
    );
    expect(normalizeArtistName("Death Grips")).toBe(
      normalizeArtistName("death-grips"),
    );
  });
});

describe("confident resolution", () => {
  it("accepts an exact canonical-name match", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("Portishead"),
      options: [{ id: "s1", uri: "spotify:artist:s1", name: "Portishead" }],
    });

    expect(result.confidence).toBe("confident");
    expect(result.selected?.spotifyId).toBe("s1");
    expect(result.reason).toMatch(/canonical/i);
  });

  it("accepts a match on a recorded alias", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("Nine Inch Nails", ["NIN"]),
      options: [{ id: "s2", uri: "spotify:artist:s2", name: "NIN" }],
    });

    expect(result.confidence).toBe("confident");
    expect(result.reason).toMatch(/alias/i);
  });

  it("matches through diacritics and articles", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("Björk"),
      options: [{ id: "s3", uri: "spotify:artist:s3", name: "Bjork" }],
    });

    expect(result.confidence).toBe("confident");
  });

  it("keeps weaker candidates as alternatives without selecting them", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("Portishead"),
      options: [
        { id: "s1", uri: "spotify:artist:s1", name: "Portishead" },
        { id: "s2", uri: "spotify:artist:s2", name: "Portishead Tribute" },
      ],
    });

    expect(result.confidence).toBe("confident");
    expect(result.selected?.spotifyId).toBe("s1");
  });
});

describe("ambiguous resolution", () => {
  it("refuses to choose between two equally exact matches", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("Nirvana"),
      options: [
        { id: "us", uri: "spotify:artist:us", name: "Nirvana" },
        { id: "uk", uri: "spotify:artist:uk", name: "Nirvana" },
      ],
    });

    expect(result.confidence).toBe("ambiguous");
    expect(result.selected).toBeNull();
    expect(result.alternatives).toHaveLength(2);
    expect(result.reason).toMatch(/choose/i);
  });
});

describe("unresolved outcomes", () => {
  it("stays unresolved when nothing matches", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("Portishead"),
      options: [{ id: "x", uri: "spotify:artist:x", name: "Massive Attack" }],
    });

    expect(result.confidence).toBe("unresolved");
    expect(result.selected).toBeNull();
  });

  it("stays unresolved when Spotify returns nothing", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("Portishead"),
      options: [],
    });

    expect(result.confidence).toBe("unresolved");
    expect(result.reason).toMatch(/no candidates/i);
  });

  it("never auto-selects a near miss", () => {
    const result = resolveSpotifyArtist({
      canonical: canonical("The Weeknd"),
      options: [{ id: "x", uri: "spotify:artist:x", name: "The Weekend" }],
    });

    expect(result.confidence).toBe("unresolved");
    expect(result.selected).toBeNull();
  });
});

describe("canonical MBID matching", () => {
  it("matches on identifier equality only", () => {
    expect(matchesCanonicalArtist("abc", "abc")).toBe(true);
    expect(matchesCanonicalArtist("abc", "def")).toBe(false);
  });

  it("treats a missing candidate identifier as no match", () => {
    expect(matchesCanonicalArtist("abc", null)).toBe(false);
  });
});
