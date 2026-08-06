import type { MoodCriteria } from "@/lib/ai/schemas";

/**
 * Deterministic playlist controls.
 *
 * The division of labour Phase 7 rests on: **AI interprets, this file
 * enforces.** A model reading "high-energy workout with 2000s rock" may suggest
 * an era and genres, but the listener's explicit settings win every time, and
 * nothing downstream consults the model's opinion again.
 *
 * Controls the product cannot honestly enforce are absent by design rather than
 * present and ignored. Energy, tempo and valence have no source outside Spotify
 * audio features, which are forbidden as a discovery input, so they survive
 * only as tag hints the interface labels as hints.
 */

export const PLAYLIST_LENGTH = {
  min: 5,
  max: 50,
  default: 20,
} as const;

export type ExplicitContentSetting = "allow" | "avoid";

export interface PlaylistControls {
  readonly length: number;
  readonly isPublic: boolean;
  /** Genres the listener insists on, overriding the model's hints. */
  readonly genres: readonly string[];
  /** Four-digit decade starts, e.g. 2000 for "2000s". */
  readonly decades: readonly number[];
  readonly explicitContent: ExplicitContentSetting;
  readonly includeArtistMbids: readonly string[];
  readonly avoidArtistMbids: readonly string[];
  /** At most this many tracks from any one artist. */
  readonly maxPerArtist: number;
}

export const DEFAULT_CONTROLS: PlaylistControls = {
  length: PLAYLIST_LENGTH.default,
  // Private unless the listener says otherwise, whatever the granted scope
  // allows. The scope permits publishing; it does not choose it.
  isPublic: false,
  genres: [],
  decades: [],
  explicitContent: "allow",
  includeArtistMbids: [],
  avoidArtistMbids: [],
  maxPerArtist: 2,
};

export function clampLength(value: number): number {
  if (!Number.isFinite(value)) return PLAYLIST_LENGTH.default;
  return Math.min(
    PLAYLIST_LENGTH.max,
    Math.max(PLAYLIST_LENGTH.min, Math.round(value)),
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The genres a seed search should use.
 *
 * Explicit settings replace the model's hints rather than merging with them: a
 * listener who typed "2000s rock" and then set the genre to jazz has changed
 * their mind, and blending the two produces a playlist matching neither.
 */
export function resolveGenres(
  criteria: MoodCriteria,
  controls: PlaylistControls,
): readonly string[] {
  const source =
    controls.genres.length > 0 ? controls.genres : criteria.genreHints;

  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const genre of source) {
    const key = normalize(genre);
    if (key.length > 0 && !seen.has(key)) {
      seen.add(key);
      resolved.push(genre.trim());
    }
  }

  return resolved;
}

/** Parses "2000s", "2000", "00s" into a decade start, or null. */
export function parseDecade(value: string): number | null {
  const match = /^(19|20)?(\d{2})s?$/.exec(value.trim());

  if (!match?.[2]) return null;

  const century = match[1];
  const pair = Number.parseInt(match[2], 10);

  if (century) {
    const year = Number.parseInt(`${century}${match[2]}`, 10);
    return Math.floor(year / 10) * 10;
  }

  // A bare two-digit decade is ambiguous. Anything from 30 up reads as 1900s,
  // below that as 2000s — the reading a listener means by "the 90s" or "the 00s".
  const decade = Math.floor(pair / 10) * 10;
  return pair >= 30 ? 1900 + decade : 2000 + decade;
}

export function resolveDecades(
  criteria: MoodCriteria,
  controls: PlaylistControls,
): readonly number[] {
  if (controls.decades.length > 0) {
    return [...new Set(controls.decades)].sort((a, b) => a - b);
  }

  const parsed = criteria.eraHints
    .map(parseDecade)
    .filter((decade): decade is number => decade !== null);

  return [...new Set(parsed)].sort((a, b) => a - b);
}

/** Whether a release year satisfies the era control. Absent year never passes
 * a stated era: excluding an unknown is honest, including it is a guess. */
export function matchesDecades(
  year: string | null,
  decades: readonly number[],
): boolean {
  if (decades.length === 0) return true;
  if (!year) return false;

  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed)) return false;

  return decades.includes(Math.floor(parsed / 10) * 10);
}

export interface ControlSummary {
  readonly label: string;
  readonly value: string;
  /** True when the product cannot enforce this and is saying so. */
  readonly isHintOnly: boolean;
}

/**
 * What the interface shows about how the request was understood.
 *
 * Hint-only entries are marked, because a control that looks enforced but is
 * not is worse than an absent one.
 */
export function summarizeControls(
  criteria: MoodCriteria,
  controls: PlaylistControls,
): readonly ControlSummary[] {
  const genres = resolveGenres(criteria, controls);
  const decades = resolveDecades(criteria, controls);

  const summary: ControlSummary[] = [
    {
      label: "Length",
      value: `${controls.length} tracks`,
      isHintOnly: false,
    },
    {
      label: "Visibility",
      value: controls.isPublic ? "Public" : "Private",
      isHintOnly: false,
    },
    {
      label: "Genres",
      value: genres.length > 0 ? genres.join(", ") : "Not specified",
      isHintOnly: false,
    },
    {
      label: "Era",
      value:
        decades.length > 0
          ? decades.map((decade) => `${decade}s`).join(", ")
          : "Any",
      isHintOnly: false,
    },
    {
      label: "Explicit content",
      value: controls.explicitContent === "avoid" ? "Excluded" : "Allowed",
      isHintOnly: false,
    },
    {
      label: "Energy",
      value: criteria.energyLevel,
      // No source outside Spotify audio features, which may not inform
      // discovery. Shown because the listener said it; marked because we
      // cannot act on it.
      isHintOnly: true,
    },
    {
      label: "Mood",
      value: criteria.primaryMood,
      isHintOnly: true,
    },
  ];

  if (criteria.languagePreferences.length > 0) {
    summary.push({
      label: "Language",
      value: criteria.languagePreferences.join(", "),
      isHintOnly: true,
    });
  }

  if (criteria.instrumentalPreference !== "any") {
    summary.push({
      label: "Vocals",
      value:
        criteria.instrumentalPreference === "instrumental"
          ? "Instrumental"
          : "Vocal",
      isHintOnly: true,
    });
  }

  return summary;
}
