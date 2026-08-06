import { describe, expect, it } from "vitest";

import type { CanonicalArtistWithDiscography } from "@/lib/providers/musicbrainz/client";
import {
  buildDiscography,
  countByCategory,
  toTimelineEntry,
} from "@/lib/discography/retrieval";
import type { DiscographyRelease } from "@/types/music";

/**
 * Shaping, ordering, and the completeness signal.
 *
 * The rule the count assertions protect: the total reported is always
 * MusicBrainz's own, never the length of what was retrieved. Reporting the
 * length is how a truncated list came to be presented as a whole discography.
 */

/**
 * `mbid` is a branded type in production and a plain string here: these cases
 * are about ordering and classification, and short readable identifiers make
 * the expected sequences legible.
 */
type ReleaseOverrides = Partial<Omit<DiscographyRelease, "mbid">> & {
  readonly mbid?: string;
};

function release(overrides: ReleaseOverrides = {}) {
  return {
    mbid: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    title: "Dummy",
    primaryType: "Album",
    secondaryTypes: [],
    firstReleaseDate: { value: "1994", precision: "year" as const },
    disambiguation: null,
    genres: [],
    tags: [],
    attribution: {
      provenance: "musicbrainz" as const,
      sourceUrl: "https://musicbrainz.org/release-group/1a2b",
      retrievedAt: "2026-08-06T00:00:00.000Z",
    },
    ...overrides,
  } as DiscographyRelease;
}

function lookupWith(
  releases: readonly DiscographyRelease[],
  overrides: Partial<CanonicalArtistWithDiscography> = {},
): CanonicalArtistWithDiscography {
  return {
    artist: { name: "Portishead" },
    releases,
    releaseGroupTotal: releases.length,
    releasesComplete: true,
    ...overrides,
  } as CanonicalArtistWithDiscography;
}

describe("classification", () => {
  it("files a live album under live, not album", () => {
    // MusicBrainz records a live album as primary Album, secondary Live.
    // Reading the primary type alone would make the live filter return nothing.
    const entry = toTimelineEntry(
      release({ primaryType: "Album", secondaryTypes: ["Live"] }),
    );

    expect(entry.category).toBe("live");
  });

  it("files a compilation under compilation", () => {
    expect(
      toTimelineEntry(
        release({ primaryType: "Album", secondaryTypes: ["Compilation"] }),
      ).category,
    ).toBe("compilation");
  });

  it("prefers live over compilation for a live compilation", () => {
    expect(
      toTimelineEntry(release({ secondaryTypes: ["Compilation", "Live"] }))
        .category,
    ).toBe("live");
  });

  it.each([
    ["Album", "album"],
    ["EP", "ep"],
    ["Single", "single"],
    ["Broadcast", "other"],
  ])("maps primary type %s to %s", (primaryType, expected) => {
    expect(toTimelineEntry(release({ primaryType })).category).toBe(expected);
  });

  it("files an untyped release under other rather than guessing", () => {
    expect(toTimelineEntry(release({ primaryType: null })).category).toBe(
      "other",
    );
  });
});

describe("ordering", () => {
  it("sorts chronologically", () => {
    const discography = buildDiscography(
      "aaaa",
      lookupWith([
        release({
          mbid: "c",
          firstReleaseDate: { value: "2008", precision: "year" },
        }),
        release({
          mbid: "a",
          firstReleaseDate: { value: "1994", precision: "year" },
        }),
        release({
          mbid: "b",
          firstReleaseDate: { value: "1997", precision: "year" },
        }),
      ]),
    );

    expect(discography.entries.map((entry) => entry.mbid)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("puts undated releases last rather than first", () => {
    const discography = buildDiscography(
      "aaaa",
      lookupWith([
        release({
          mbid: "undated",
          firstReleaseDate: { value: null, precision: "unknown" },
        }),
        release({
          mbid: "dated",
          firstReleaseDate: { value: "1994", precision: "year" },
        }),
      ]),
    );

    expect(discography.entries.map((entry) => entry.mbid)).toEqual([
      "dated",
      "undated",
    ]);
  });

  it("preserves date precision rather than padding it", () => {
    // "1997" and "1997-01-01" are different claims.
    const entry = toTimelineEntry(
      release({ firstReleaseDate: { value: "1997", precision: "year" } }),
    );

    expect(entry.firstReleaseDate).toEqual({
      value: "1997",
      precision: "year",
    });
  });
});

describe("completeness", () => {
  it("reports MusicBrainz's total, not the number retrieved", () => {
    const discography = buildDiscography(
      "aaaa",
      lookupWith([release()], {
        releaseGroupTotal: 573,
        releasesComplete: false,
      }),
    );

    expect(discography.total).toBe(573);
    expect(discography.entries).toHaveLength(1);
    expect(discography.retrievalComplete).toBe(false);
  });

  it("carries a complete retrieval through unchanged", () => {
    const discography = buildDiscography(
      "aaaa",
      lookupWith([release(), release({ mbid: "second" })]),
    );

    expect(discography.total).toBe(2);
    expect(discography.retrievalComplete).toBe(true);
  });
});

describe("category counts", () => {
  it("counts each category for the filter chips", () => {
    const counts = countByCategory(
      buildDiscography(
        "aaaa",
        lookupWith([
          release({ mbid: "a" }),
          release({ mbid: "b" }),
          release({ mbid: "c", primaryType: "EP" }),
          release({ mbid: "d", secondaryTypes: ["Live"] }),
        ]),
      ),
    );

    expect(counts.album).toBe(2);
    expect(counts.ep).toBe(1);
    expect(counts.live).toBe(1);
  });
});
