import type { Discography, TimelineEntry } from "@/lib/discography/types";

/**
 * Suggested questions, derived from the records that would have to answer them.
 *
 * The panel offered four fixed prompts until Phase 10. On an artist with no
 * live album, "Did they release any live albums?" was a question the product
 * suggested and then declined — the decline was correct, and the suggestion was
 * what made it read as a fault. Roadmap follow-up "suggested questions are
 * static" tracked this to here.
 *
 * Two rules hold every suggestion below:
 *
 * 1. A suggestion is offered only when the retrieved timeline contains the
 *    records that answer it. Nothing here is a guess about what might exist.
 * 2. Nothing that requires a total is offered when retrieval was truncated. A
 *    count over a partial list is a wrong answer delivered confidently, which
 *    is the one failure mode this product spends the most effort avoiding.
 *
 * Pure over the domain type: no provider call, no schema, no I/O.
 */

const MAX_SUGGESTIONS = 4;

function hasYear(entry: TimelineEntry): boolean {
  return entry.firstReleaseDate.value !== null;
}

function yearOf(entry: TimelineEntry): number | null {
  const value = entry.firstReleaseDate.value;

  if (value === null) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/** The decade holding the most dated albums, when one holds at least two. */
function busiestAlbumDecade(entries: readonly TimelineEntry[]): number | null {
  const counts = new Map<number, number>();

  for (const entry of entries) {
    if (entry.category !== "album") {
      continue;
    }

    const year = yearOf(entry);

    if (year === null) {
      continue;
    }

    const decade = Math.floor(year / 10) * 10;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }

  // Ascending, so a tie resolves to the earlier decade rather than to whichever
  // the Map happened to see first. Retrieval order would otherwise decide, and
  // the same artist would be asked about a different decade between two loads.
  const ranked = [...counts.entries()].sort(
    (first, second) => second[1] - first[1] || first[0] - second[0],
  );

  const [top] = ranked;

  return top && top[1] >= 2 ? top[0] : null;
}

export function suggestedQuestions(
  discography: Discography,
): readonly string[] {
  const { entries, retrievalComplete } = discography;
  const suggestions: string[] = [];

  const countOf = (category: TimelineEntry["category"]) =>
    entries.filter((entry) => entry.category === category).length;

  const datedAlbums = entries.filter(
    (entry) => entry.category === "album" && hasYear(entry),
  );

  if (datedAlbums.length > 0) {
    suggestions.push("What was their first studio album?");
  }

  const decade = busiestAlbumDecade(entries);

  if (decade !== null) {
    suggestions.push(`Which albums came out in the ${decade}s?`);
  }

  if (countOf("ep") >= 2) {
    suggestions.push("List their EPs in chronological order.");
  }

  if (countOf("live") > 0) {
    suggestions.push("Which of their releases are live albums?");
  }

  if (countOf("compilation") > 0) {
    suggestions.push("Which of their releases are compilations?");
  }

  // Counting questions need the whole list. `total` is MusicBrainz's own count
  // and exceeds `entries.length` exactly when the page bound engaged.
  if (retrievalComplete && countOf("single") >= 2) {
    suggestions.push("How many singles have they released?");
  }

  if (retrievalComplete && entries.filter(hasYear).length >= 2) {
    suggestions.push("What was their most recent release?");
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}
