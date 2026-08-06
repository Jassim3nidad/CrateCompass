import type { CanonicalArtistWithDiscography } from "@/lib/providers/musicbrainz/client";
import type { DiscographyRelease } from "@/types/music";
import type {
  Discography,
  ReleaseCategory,
  TimelineEntry,
} from "@/lib/discography/types";

/**
 * Shaping a retrieved discography into a timeline.
 *
 * Retrieval itself is not repeated here. `lookupArtist` already escalates a
 * result of exactly 25 to the paged browse endpoint, reports MusicBrainz's true
 * total, and caches for six hours — all of it landed with the truncation fix in
 * `330faea`. Re-fetching would be a second, uncached path to the same data and
 * a second place for the cap to hide.
 *
 * What this module owns is everything after the bytes arrive: classification
 * into the categories the interface filters on, chronological ordering that
 * respects partial dates, and carrying the completeness signal forward so it
 * cannot be dropped between the client and the screen.
 */

/**
 * Secondary types decide first, and deliberately so.
 *
 * MusicBrainz records a live album as primary type Album with secondary type
 * Live. Reading the primary type alone would file it under "album", which is
 * the classification a listener would call wrong, and would make the live
 * filter return nothing on the artists most likely to have live records.
 */
function categorize(release: DiscographyRelease): ReleaseCategory {
  const secondary = new Set(
    release.secondaryTypes.map((type) => type.toLowerCase()),
  );

  if (secondary.has("live")) return "live";
  if (secondary.has("soundtrack")) return "soundtrack";
  if (secondary.has("compilation")) return "compilation";

  switch (release.primaryType?.toLowerCase()) {
    case "album":
      return "album";
    case "ep":
      return "ep";
    case "single":
      return "single";
    default:
      return "other";
  }
}

/**
 * Chronological order, with undated releases last.
 *
 * Partial dates compare as strings on purpose. "1997" sorts before "1997-03"
 * because it is a prefix, which puts a year-only record ahead of a
 * month-precise one in the same year — a stable, explainable choice. Padding
 * "1997" to "1997-01-01" to get a numeric comparison would invent a precision
 * MusicBrainz did not record.
 */
function byReleaseDate(left: TimelineEntry, right: TimelineEntry): number {
  const leftDate = left.firstReleaseDate.value;
  const rightDate = right.firstReleaseDate.value;

  if (leftDate === null && rightDate === null) {
    return left.title.localeCompare(right.title);
  }

  if (leftDate === null) return 1;
  if (rightDate === null) return -1;

  return leftDate === rightDate
    ? left.title.localeCompare(right.title)
    : leftDate.localeCompare(rightDate);
}

export function toTimelineEntry(release: DiscographyRelease): TimelineEntry {
  return {
    mbid: release.mbid,
    title: release.title,
    category: categorize(release),
    primaryType: release.primaryType,
    secondaryTypes: release.secondaryTypes,
    firstReleaseDate: release.firstReleaseDate,
    disambiguation: release.disambiguation,
    sourceUrl: release.attribution.sourceUrl,
  };
}

/** Builds the explorer's view of an artist from a completed lookup. */
export function buildDiscography(
  artistMbid: string,
  lookup: CanonicalArtistWithDiscography,
): Discography {
  const entries = lookup.releases.map(toTimelineEntry).sort(byReleaseDate);

  return {
    artistMbid,
    artistName: lookup.artist.name,
    entries,
    // MusicBrainz's own total, never `entries.length`. Reporting the length
    // would restate the truncation as if it were the whole catalogue.
    total: lookup.releaseGroupTotal,
    retrievalComplete: lookup.releasesComplete,
  };
}

/** Counts by category, for the filter chips. */
export function countByCategory(
  discography: Discography,
): Readonly<Record<ReleaseCategory, number>> {
  const counts: Record<string, number> = {};

  for (const entry of discography.entries) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }

  return counts as Readonly<Record<ReleaseCategory, number>>;
}
