import type { TaggedArtistCandidate } from "@/types/music";

/**
 * Re-ranking for MusicBrainz tag search.
 *
 * The problem this exists to solve, measured rather than assumed: searching
 * `tag:"trip hop"` returns Fatboy Slim, Moby and **Madonna** in the top three,
 * and `tag:"ambient"` returns **Various Artists** and **[unknown]** first.
 * Lucene orders by text relevance, which has nothing to do with how strongly an
 * artist belongs to a tag.
 *
 * Two corrections, in order:
 *
 * 1. **Remove what is not an artist.** Placeholder entities exist in
 *    MusicBrainz for cataloguing reasons and are never a useful seed.
 * 2. **Rank by the tag's own vote count**, which is a community signal about
 *    belonging, falling back to search score only when an artist carries no
 *    inline tags — roughly half of search hits do not.
 *
 * This produces a better list, not a correct one. A person still confirms the
 * seed; that step is the actual quality control and is not optional.
 */

/**
 * Catalogue placeholders, matched on the whole normalised name so a real band
 * called "Unknown Mortal Orchestra" is not caught by a substring rule.
 */
const PLACEHOLDER_NAMES = new Set([
  "various artists",
  "unknown",
  "[unknown]",
  "no artist",
  "[no artist]",
  "traditional",
  "[traditional]",
  "anonymous",
  "soundtrack",
  "[soundtrack]",
  "data",
  "[data]",
  "dialogue",
  "[dialogue]",
]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function isPlaceholderArtist(name: string): boolean {
  const normalized = normalize(name);
  return (
    PLACEHOLDER_NAMES.has(normalized) ||
    // Square-bracketed names are MusicBrainz's own convention for
    // non-artist entities.
    (normalized.startsWith("[") && normalized.endsWith("]"))
  );
}

export interface RankedSeed {
  readonly candidate: TaggedArtistCandidate;
  /** Community votes for the searched tag, or 0 when none are recorded. */
  readonly tagVotes: number;
  /** True when ranking fell back to search score for want of tag data. */
  readonly rankedByRelevanceOnly: boolean;
}

function votesForTag(
  candidate: TaggedArtistCandidate,
  tag: string,
): number | null {
  const target = normalize(tag);

  for (const entry of candidate.tags) {
    const name = normalize(entry.name);
    // MusicBrainz records both "trip hop" and "trip-hop" as distinct tags for
    // the same idea, so hyphens are compared as spaces.
    if (
      name === target ||
      name.replace(/-/g, " ") === target.replace(/-/g, " ")
    ) {
      return entry.count;
    }
  }

  return candidate.tags.length > 0 ? 0 : null;
}

export function rankSeedCandidates(input: {
  readonly candidates: readonly TaggedArtistCandidate[];
  readonly tag: string;
  readonly avoidMbids?: readonly string[];
  readonly limit?: number;
}): readonly RankedSeed[] {
  const avoid = new Set(input.avoidMbids ?? []);

  const ranked = input.candidates
    .filter(
      (candidate) =>
        !isPlaceholderArtist(candidate.name) && !avoid.has(candidate.mbid),
    )
    .map((candidate) => {
      const votes = votesForTag(candidate, input.tag);

      return {
        candidate,
        tagVotes: votes ?? 0,
        rankedByRelevanceOnly: votes === null,
      } satisfies RankedSeed;
    })
    .sort((first, second) => {
      // An artist with recorded votes always outranks one without, because a
      // missing tag list is absent evidence rather than evidence of absence.
      if (first.rankedByRelevanceOnly !== second.rankedByRelevanceOnly) {
        return first.rankedByRelevanceOnly ? 1 : -1;
      }

      if (second.tagVotes !== first.tagVotes) {
        return second.tagVotes - first.tagVotes;
      }

      return (
        (second.candidate.searchScore ?? 0) - (first.candidate.searchScore ?? 0)
      );
    });

  return input.limit ? ranked.slice(0, input.limit) : ranked;
}
