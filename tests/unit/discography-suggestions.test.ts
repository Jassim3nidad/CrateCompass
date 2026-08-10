import { describe, expect, it } from "vitest";

import { suggestedQuestions } from "@/lib/discography/suggestions";
import type {
  Discography,
  ReleaseCategory,
  TimelineEntry,
} from "@/lib/discography/types";

function entry(
  title: string,
  category: ReleaseCategory,
  year: string | null,
): TimelineEntry {
  return {
    mbid: `mbid-${title}`,
    title,
    category,
    primaryType: category === "album" ? "Album" : null,
    secondaryTypes: [],
    firstReleaseDate: {
      value: year,
      precision: year === null ? "unknown" : "year",
    },
    disambiguation: null,
    sourceUrl: null,
  };
}

function discography(
  entries: readonly TimelineEntry[],
  overrides: Partial<Discography> = {},
): Discography {
  return {
    artistMbid: "a1b2c3d4-0000-0000-0000-000000000000",
    artistName: "Test Artist",
    entries,
    total: entries.length,
    retrievalComplete: true,
    ...overrides,
  };
}

describe("suggestedQuestions", () => {
  it("offers nothing for an artist with no retrieved releases", () => {
    expect(suggestedQuestions(discography([]))).toEqual([]);
  });

  it("offers the first-album question only when a dated album exists", () => {
    const undated = suggestedQuestions(
      discography([entry("Untitled", "album", null)]),
    );
    expect(undated).not.toContain("What was their first studio album?");

    const dated = suggestedQuestions(
      discography([entry("Debut", "album", "1994-03-01")]),
    );
    expect(dated).toContain("What was their first studio album?");
  });

  it("does not offer a live-album question when there is no live release", () => {
    // The defect this whole module exists for: the panel suggested a question,
    // the records could not support it, and the honest refusal read as a fault.
    const suggestions = suggestedQuestions(
      discography([
        entry("Debut", "album", "1994"),
        entry("Second", "album", "1997"),
      ]),
    );

    expect(suggestions.join(" ")).not.toMatch(/live/i);
  });

  it("offers the live question once a live release is present", () => {
    const suggestions = suggestedQuestions(
      discography([
        entry("Debut", "album", "1994"),
        entry("At the Hall", "live", "1998"),
      ]),
    );

    expect(suggestions).toContain("Which of their releases are live albums?");
  });

  it("names the decade that actually holds the most albums", () => {
    const suggestions = suggestedQuestions(
      discography([
        entry("One", "album", "1994"),
        entry("Two", "album", "2011"),
        entry("Three", "album", "2015"),
        entry("Four", "album", "2018"),
      ]),
    );

    expect(suggestions).toContain("Which albums came out in the 2010s?");
  });

  it("resolves a decade tie to the earlier decade, not to retrieval order", () => {
    const entries = [
      entry("Late One", "album", "2011"),
      entry("Late Two", "album", "2012"),
      entry("Early One", "album", "1991"),
      entry("Early Two", "album", "1992"),
    ];

    // Same set, opposite order: the suggestion must not depend on which the
    // provider happened to return first.
    expect(suggestedQuestions(discography(entries))).toContain(
      "Which albums came out in the 1990s?",
    );
    expect(suggestedQuestions(discography([...entries].reverse()))).toContain(
      "Which albums came out in the 1990s?",
    );
  });

  it("does not name a decade holding a single album", () => {
    const suggestions = suggestedQuestions(
      discography([
        entry("One", "album", "1994"),
        entry("Two", "album", "2005"),
      ]),
    );

    expect(suggestions.join(" ")).not.toMatch(/came out in the/);
  });

  it("requires two EPs before offering to list them", () => {
    const one = suggestedQuestions(
      discography([entry("Solo EP", "ep", "2001")]),
    );
    expect(one).not.toContain("List their EPs in chronological order.");

    const two = suggestedQuestions(
      discography([
        entry("EP One", "ep", "2001"),
        entry("EP Two", "ep", "2003"),
      ]),
    );
    expect(two).toContain("List their EPs in chronological order.");
  });

  it("withholds counting questions when retrieval was truncated", () => {
    const entries = [
      entry("Single One", "single", "2001"),
      entry("Single Two", "single", "2002"),
      entry("Single Three", "single", "2003"),
    ];

    // A count over a partial list is a wrong answer delivered confidently,
    // which is exactly the failure the retrievalComplete flag exists to stop.
    const truncated = suggestedQuestions(
      discography(entries, { total: 573, retrievalComplete: false }),
    );
    expect(truncated).not.toContain("How many singles have they released?");
    expect(truncated).not.toContain("What was their most recent release?");

    const complete = suggestedQuestions(discography(entries));
    expect(complete).toContain("How many singles have they released?");
  });

  it("never offers more than four suggestions", () => {
    const suggestions = suggestedQuestions(
      discography([
        entry("Album One", "album", "2011"),
        entry("Album Two", "album", "2013"),
        entry("EP One", "ep", "2012"),
        entry("EP Two", "ep", "2014"),
        entry("Live", "live", "2015"),
        entry("Best Of", "compilation", "2016"),
        entry("Single One", "single", "2017"),
        entry("Single Two", "single", "2018"),
      ]),
    );

    expect(suggestions).toHaveLength(4);
    expect(new Set(suggestions).size).toBe(4);
  });
});
