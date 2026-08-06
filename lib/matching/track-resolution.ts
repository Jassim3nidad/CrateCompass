import { normalizeArtistName } from "@/lib/matching/artist-resolution";
import type { MatchConfidence } from "@/types/music";

/**
 * Deterministic track matching against Spotify search results.
 *
 * The same rule as artist resolution, for the same reason: a fuzzy threshold
 * that silently picks the closest thing is how a playlist ends up containing a
 * karaoke cover. Both the title and the credited artist must match exactly
 * after normalisation, and anything weaker is reported unresolved rather than
 * guessed.
 *
 * Spotify's own ordering is deliberately not used as a tiebreaker. Spotify
 * resolves candidates here; it does not choose them.
 */

/**
 * Version qualifiers that make a recording a different thing from the one
 * MusicBrainz named, even when the base title matches.
 */
const VERSION_MARKERS =
  /\b(live|remix|remaster(ed)?|acoustic|instrumental|karaoke|cover|demo|edit|mix|version|radio)\b/i;

export function normalizeTrackTitle(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // Parenthesised and bracketed suffixes carry the version qualifiers.
      .replace(/[([{][^)\]}]*[)\]}]/g, " ")
      .replace(/\s*-\s*.*$/, "")
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ")
  );
}

export interface SpotifyTrackOption {
  readonly id: string;
  readonly uri: string;
  readonly name: string;
  readonly artistNames: readonly string[];
  readonly isExplicit: boolean;
}

export interface TrackResolution {
  readonly confidence: MatchConfidence;
  readonly selected: SpotifyTrackOption | null;
  readonly reason: string;
}

export function resolveSpotifyTrack(input: {
  readonly title: string;
  readonly artistName: string;
  readonly options: readonly SpotifyTrackOption[];
  /** When true, an explicit result is rejected rather than selected. */
  readonly avoidExplicit: boolean;
}): TrackResolution {
  if (input.options.length === 0) {
    return {
      confidence: "unresolved",
      selected: null,
      reason: "Spotify returned no results for this recording.",
    };
  }

  const wantedTitle = normalizeTrackTitle(input.title);
  const wantedArtist = normalizeArtistName(input.artistName);

  const matches = input.options.filter((option) => {
    const artistMatches = option.artistNames.some(
      (name) => normalizeArtistName(name) === wantedArtist,
    );

    if (!artistMatches) return false;

    const titleMatches = normalizeTrackTitle(option.name) === wantedTitle;

    if (!titleMatches) return false;

    // A qualifier the source title did not carry means Spotify is offering a
    // different recording under a matching name.
    const addsVersionMarker =
      VERSION_MARKERS.test(option.name) && !VERSION_MARKERS.test(input.title);

    return !addsVersionMarker;
  });

  if (matches.length === 0) {
    return {
      confidence: "unresolved",
      selected: null,
      reason:
        "No Spotify result matched both the recording title and the credited artist.",
    };
  }

  const permitted = input.avoidExplicit
    ? matches.filter((option) => !option.isExplicit)
    : matches;

  if (permitted.length === 0) {
    return {
      confidence: "unresolved",
      selected: null,
      reason:
        "The only Spotify matches are marked explicit, which this playlist excludes.",
    };
  }

  const [selected] = permitted;

  if (!selected) {
    return {
      confidence: "unresolved",
      selected: null,
      reason: "No Spotify result could be scored.",
    };
  }

  return {
    confidence: "confident",
    selected,
    reason: "Exact match on recording title and credited artist.",
  };
}
