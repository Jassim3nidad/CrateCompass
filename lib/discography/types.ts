import type { PartialDate } from "@/types/music";

/**
 * The discography explorer's own vocabulary.
 *
 * Nothing here holds a Spotify value, and nothing here is a provider response
 * type: MusicBrainz shapes are normalised at the edge so the explorer, the
 * selection logic and the interface all speak the same language.
 */

/** The filter set the interface offers, and the only categories it claims. */
export const RELEASE_CATEGORIES = [
  "album",
  "ep",
  "single",
  "live",
  "compilation",
  "soundtrack",
  "other",
] as const;

export type ReleaseCategory = (typeof RELEASE_CATEGORIES)[number];

export interface TimelineEntry {
  readonly mbid: string;
  readonly title: string;
  readonly category: ReleaseCategory;
  readonly primaryType: string | null;
  readonly secondaryTypes: readonly string[];
  readonly firstReleaseDate: PartialDate;
  readonly disambiguation: string | null;
  /** Null when MusicBrainz supplied no link; the interface then omits it. */
  readonly sourceUrl: string | null;
}

export interface Discography {
  readonly artistMbid: string;
  readonly artistName: string;
  readonly entries: readonly TimelineEntry[];
  /**
   * MusicBrainz's own count, which is not necessarily `entries.length`. The two
   * differ exactly when retrieval stopped at the safety bound.
   */
  readonly total: number;
  /**
   * False when the 10-page bound engaged. A caller that states a count, or
   * answers a counting question, must check this: presenting a truncated list
   * as a whole discography is the failure the field exists to prevent.
   */
  readonly retrievalComplete: boolean;
}
