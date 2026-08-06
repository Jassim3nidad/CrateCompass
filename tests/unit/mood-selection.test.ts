import { describe, expect, it } from "vitest";

import { DEFAULT_CONTROLS } from "@/lib/mood/controls";
import {
  isPlaceholderArtist,
  rankSeedCandidates,
} from "@/lib/mood/seed-ranking";
import {
  dedupeTracks,
  interleaveByArtist,
  isStudioAlbum,
  selectArtistTracks,
  selectStudioReleases,
  type TrackCandidateDraft,
} from "@/lib/mood/track-selection";
import {
  normalizeTrackTitle,
  resolveSpotifyTrack,
} from "@/lib/matching/track-resolution";
import {
  asMusicBrainzId,
  type DiscographyRelease,
  type ReleaseTrack,
  type SourceAttribution,
  type TaggedArtistCandidate,
} from "@/types/music";

const attribution: SourceAttribution = {
  provenance: "musicbrainz",
  sourceUrl: "https://musicbrainz.org/artist/x",
  retrievedAt: "2026-08-05T10:00:00.000Z",
};

function tagged(
  overrides: Partial<TaggedArtistCandidate> = {},
): TaggedArtistCandidate {
  return {
    mbid: asMusicBrainzId("11111111-1111-4111-8111-111111111111"),
    name: "Vellum Coast",
    sortName: "Vellum Coast",
    disambiguation: null,
    type: "Group",
    country: "GB",
    searchScore: 50,
    tags: [],
    attribution,
    ...overrides,
  };
}

function release(
  overrides: Partial<DiscographyRelease> = {},
): DiscographyRelease {
  return {
    mbid: asMusicBrainzId("33333333-3333-4333-8333-333333333333"),
    title: "Tidal Frame",
    primaryType: "Album",
    secondaryTypes: [],
    firstReleaseDate: { value: "1994", precision: "year" },
    disambiguation: null,
    genres: [],
    tags: [],
    attribution,
    ...overrides,
  };
}

describe("seed ranking", () => {
  it("recognises the catalogue placeholders that outrank real artists", () => {
    // Measured, not hypothetical: `tag:"ambient"` returned these first.
    expect(isPlaceholderArtist("Various Artists")).toBe(true);
    expect(isPlaceholderArtist("[unknown]")).toBe(true);
    expect(isPlaceholderArtist("[traditional]")).toBe(true);

    // A real band whose name merely contains a placeholder word must survive.
    expect(isPlaceholderArtist("Unknown Mortal Orchestra")).toBe(false);
  });

  it("ranks by community tag votes rather than Lucene relevance", () => {
    const ranked = rankSeedCandidates({
      tag: "trip hop",
      candidates: [
        tagged({
          mbid: asMusicBrainzId("aaaaaaaa-1111-4111-8111-111111111111"),
          name: "Loud Relevance",
          searchScore: 100,
          tags: [{ name: "trip hop", count: 2 }],
        }),
        tagged({
          mbid: asMusicBrainzId("bbbbbbbb-1111-4111-8111-111111111111"),
          name: "Actually Trip Hop",
          searchScore: 40,
          tags: [{ name: "trip hop", count: 90 }],
        }),
      ],
    });

    expect(ranked[0]?.candidate.name).toBe("Actually Trip Hop");
  });

  it("treats hyphenated and spaced tags as the same tag", () => {
    const ranked = rankSeedCandidates({
      tag: "trip hop",
      candidates: [tagged({ tags: [{ name: "trip-hop", count: 30 }] })],
    });

    expect(ranked[0]?.tagVotes).toBe(30);
    expect(ranked[0]?.rankedByRelevanceOnly).toBe(false);
  });

  it("ranks an artist with no tag data below one that has some", () => {
    // Half of live search hits carry no inline tags, so absent evidence must
    // not be read as zero votes.
    const ranked = rankSeedCandidates({
      tag: "ambient",
      candidates: [
        tagged({
          mbid: asMusicBrainzId("cccccccc-1111-4111-8111-111111111111"),
          name: "No Tags",
          searchScore: 100,
          tags: [],
        }),
        tagged({
          mbid: asMusicBrainzId("dddddddd-1111-4111-8111-111111111111"),
          name: "One Vote",
          searchScore: 10,
          tags: [{ name: "ambient", count: 1 }],
        }),
      ],
    });

    expect(ranked[0]?.candidate.name).toBe("One Vote");
    expect(ranked[1]?.rankedByRelevanceOnly).toBe(true);
  });

  it("removes placeholders and avoided artists", () => {
    const ranked = rankSeedCandidates({
      tag: "ambient",
      avoidMbids: ["eeeeeeee-1111-4111-8111-111111111111"],
      candidates: [
        tagged({ name: "Various Artists" }),
        tagged({
          mbid: asMusicBrainzId("eeeeeeee-1111-4111-8111-111111111111"),
          name: "Avoided",
        }),
        tagged({
          mbid: asMusicBrainzId("ffffffff-1111-4111-8111-111111111111"),
          name: "Kept",
        }),
      ],
    });

    expect(ranked.map((entry) => entry.candidate.name)).toEqual(["Kept"]);
  });
});

describe("studio release selection", () => {
  it("excludes anything that is not a studio album", () => {
    expect(isStudioAlbum(release())).toBe(true);
    expect(isStudioAlbum(release({ secondaryTypes: ["Live"] }))).toBe(false);
    expect(isStudioAlbum(release({ secondaryTypes: ["Compilation"] }))).toBe(
      false,
    );
    expect(isStudioAlbum(release({ primaryType: "Single" }))).toBe(false);
  });

  it("honours the era control", () => {
    const selected = selectStudioReleases({
      releases: [
        release({ firstReleaseDate: { value: "1994", precision: "year" } }),
        release({
          mbid: asMusicBrainzId("44444444-4444-4444-8444-444444444444"),
          title: "Later",
          firstReleaseDate: { value: "2011", precision: "year" },
        }),
      ],
      controls: { ...DEFAULT_CONTROLS, decades: [2010] },
      limit: 5,
    });

    expect(selected.map((entry) => entry.title)).toEqual(["Later"]);
  });

  it("drops releases with no recorded date rather than guessing", () => {
    const selected = selectStudioReleases({
      releases: [
        release({ firstReleaseDate: { value: null, precision: "unknown" } }),
      ],
      controls: DEFAULT_CONTROLS,
      limit: 5,
    });

    expect(selected).toEqual([]);
  });
});

describe("track selection", () => {
  function track(position: number, title: string): ReleaseTrack {
    return {
      recordingMbid: asMusicBrainzId(
        `55555555-5555-4555-8555-${String(position).padStart(12, "0")}`,
      ),
      title,
      position,
      mediumPosition: 1,
      lengthMs: 200_000,
      releaseTitle: "Tidal Frame",
      releaseGroupMbid: asMusicBrainzId("33333333-3333-4333-8333-333333333333"),
    };
  }

  it("takes opening tracks, which is the only editorial signal available", () => {
    const selected = selectArtistTracks({
      artistMbid: "artist-1",
      artistName: "Vellum Coast",
      tracks: [track(3, "Third"), track(1, "First"), track(2, "Second")],
      releaseYear: "1994",
      maxTracks: 2,
    });

    expect(selected.map((entry) => entry.title)).toEqual(["First", "Second"]);
  });

  it("removes a re-recording that shares a title with one already chosen", () => {
    const drafts: TrackCandidateDraft[] = [
      {
        recordingMbid: "rec-1",
        title: "Slack Water",
        artistMbid: "artist-1",
        artistName: "Vellum Coast",
        releaseTitle: "Tidal Frame",
        releaseYear: "1994",
        lengthMs: null,
      },
      {
        recordingMbid: "rec-2",
        title: "slack water",
        artistMbid: "artist-1",
        artistName: "Vellum Coast",
        releaseTitle: "Long Ferry",
        releaseYear: "2001",
        lengthMs: null,
      },
    ];

    expect(dedupeTracks(drafts)).toHaveLength(1);
  });

  it("interleaves artists so the playlist is not artist-blocked", () => {
    const drafts: TrackCandidateDraft[] = ["a", "a", "b", "b"].map(
      (artist, index) => ({
        recordingMbid: `rec-${index}`,
        title: `Track ${index}`,
        artistMbid: artist,
        artistName: artist.toUpperCase(),
        releaseTitle: "Album",
        releaseYear: "1994",
        lengthMs: null,
      }),
    );

    expect(interleaveByArtist(drafts).map((entry) => entry.artistMbid)).toEqual(
      ["a", "b", "a", "b"],
    );
  });
});

describe("Spotify track resolution", () => {
  const base = {
    title: "Safe From Harm",
    artistName: "Massive Attack",
    avoidExplicit: false,
  };

  function option(
    overrides: Partial<
      Parameters<typeof resolveSpotifyTrack>[0]["options"][number]
    > = {},
  ) {
    return {
      id: "track-1",
      uri: "spotify:track:1",
      name: "Safe From Harm",
      artistNames: ["Massive Attack"],
      isExplicit: false,
      ...overrides,
    };
  }

  it("normalises away version suffixes when comparing titles", () => {
    expect(normalizeTrackTitle("Safe From Harm (2012 Remaster)")).toBe(
      "safe from harm",
    );
    expect(normalizeTrackTitle("Safe From Harm - Live")).toBe("safe from harm");
  });

  it("matches on both title and credited artist", () => {
    const result = resolveSpotifyTrack({ ...base, options: [option()] });

    expect(result.confidence).toBe("confident");
    expect(result.selected?.uri).toBe("spotify:track:1");
  });

  it("refuses a match credited to a different artist", () => {
    const result = resolveSpotifyTrack({
      ...base,
      options: [option({ artistNames: ["Karaoke Ensemble"] })],
    });

    expect(result.confidence).toBe("unresolved");
  });

  it("refuses a live version when the source recording was not live", () => {
    // This is how a playlist ends up containing a karaoke cover.
    const result = resolveSpotifyTrack({
      ...base,
      options: [option({ name: "Safe From Harm (Live at Glastonbury)" })],
    });

    expect(result.confidence).toBe("unresolved");
  });

  it("honours the explicit-content setting", () => {
    const result = resolveSpotifyTrack({
      ...base,
      avoidExplicit: true,
      options: [option({ isExplicit: true })],
    });

    expect(result.confidence).toBe("unresolved");
    expect(result.reason).toMatch(/explicit/i);
  });

  it("reports no results honestly rather than picking something", () => {
    const result = resolveSpotifyTrack({ ...base, options: [] });

    expect(result.confidence).toBe("unresolved");
    expect(result.selected).toBeNull();
  });
});
