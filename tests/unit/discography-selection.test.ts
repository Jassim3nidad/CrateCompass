import { describe, expect, it } from "vitest";

import {
  isCountingQuestion,
  MAX_CONTEXT_RELEASES,
  selectContext,
} from "@/lib/discography/selection";
import type {
  Discography,
  ReleaseCategory,
  TimelineEntry,
} from "@/lib/discography/types";

/**
 * Selection is where this phase is won or lost.
 *
 * Two failures matter and both are silent. Filtering too aggressively drops the
 * release holding the answer, which produces a confident "the records do not
 * say" about something the records do say. Filtering too little overruns the
 * 200-release schema bound, and the cut lands wherever the array happened to
 * end.
 *
 * The design rule these tests protect: **matching only ever promotes, never
 * removes.** Everything stays in the context until the bound cuts it.
 */

function entry(
  index: number,
  overrides: Partial<TimelineEntry> = {},
): TimelineEntry {
  const mbid = `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

  return {
    mbid,
    title: `Release ${index}`,
    category: "album" as ReleaseCategory,
    primaryType: "Album",
    secondaryTypes: [],
    firstReleaseDate: { value: `${1970 + index}`, precision: "year" },
    disambiguation: null,
    sourceUrl: `https://musicbrainz.org/release-group/${mbid}`,
    ...overrides,
  };
}

function discographyOf(
  entries: readonly TimelineEntry[],
  overrides: Partial<Discography> = {},
): Discography {
  return {
    artistMbid: "aaaaaaaa-0000-4000-8000-000000000000",
    artistName: "Test Artist",
    entries,
    total: entries.length,
    retrievalComplete: true,
    ...overrides,
  };
}

describe("the answer-bearing release is never filtered out", () => {
  it("keeps a release that shares no term with the question", () => {
    // The failure this guards: a question about the 1990s, and the album that
    // answers it is called something with no overlapping word. A filter would
    // drop it; promotion keeps it.
    const answerBearing = entry(5, {
      title: "Dummy",
      firstReleaseDate: { value: "1994", precision: "year" },
    });

    const context = selectContext({
      discography: discographyOf([entry(1), entry(2), answerBearing, entry(9)]),
      question: "which record came out in 1994?",
    });

    expect(context.entries.map((item) => item.mbid)).toContain(
      answerBearing.mbid,
    );
  });

  it("keeps a live album when the question names only a year", () => {
    const live = entry(7, {
      title: "Roseland NYC",
      category: "live",
      secondaryTypes: ["Live"],
      firstReleaseDate: { value: "1998", precision: "year" },
    });

    const context = selectContext({
      discography: discographyOf([entry(1), live, entry(3)]),
      question: "what came out in 1998?",
    });

    expect(context.entries.map((item) => item.mbid)).toContain(live.mbid);
  });

  it("returns the whole discography for a question matching nothing", () => {
    // An unmatched question must not produce an empty context. An empty context
    // guarantees an "insufficient context" answer that is not actually true.
    const entries = [entry(1), entry(2), entry(3)];

    const context = selectContext({
      discography: discographyOf(entries),
      question: "zzzz qqqq vvvv",
    });

    expect(context.entries).toHaveLength(3);
    expect(context.contextTruncated).toBe(false);
  });

  it("keeps every release when a type filter term is present", () => {
    // "albums" in the question must not exclude the EPs from the context; it
    // may only rank albums above them.
    const entries = [
      entry(1, { category: "ep", primaryType: "EP" }),
      entry(2, { category: "album" }),
      entry(3, { category: "single", primaryType: "Single" }),
    ];

    const context = selectContext({
      discography: discographyOf(entries),
      question: "list their albums",
    });

    expect(context.entries).toHaveLength(3);
  });
});

describe("the 200-release bound", () => {
  const prolific = Array.from({ length: 573 }, (_, index) => entry(index + 1));

  it("selects exactly the bound for a prolific artist", () => {
    const context = selectContext({
      discography: discographyOf(prolific),
      question: "list their albums",
    });

    expect(context.entries).toHaveLength(MAX_CONTEXT_RELEASES);
  });

  it("reports the truncation rather than cutting silently", () => {
    const context = selectContext({
      discography: discographyOf(prolific),
      question: "list their albums",
    });

    expect(context.contextTruncated).toBe(true);
    expect(context.criteria.some((item) => item.label === "Bound")).toBe(true);
  });

  it("cuts by stated priority, not by arrival order", () => {
    // The release answering the question sits at the very end of the array, far
    // outside the first 200. Selecting by arrival order would drop it.
    const answerBearing = entry(9999, {
      title: "The Last One",
      firstReleaseDate: { value: "2013", precision: "year" },
    });

    const context = selectContext({
      discography: discographyOf([...prolific, answerBearing]),
      question: "which album came out in 2013?",
    });

    expect(context.entries.map((item) => item.mbid)).toContain(
      answerBearing.mbid,
    );
  });

  it("returns the selection in chronological order, not ranked order", () => {
    const context = selectContext({
      discography: discographyOf([...prolific]),
      question: "which album came out in 2013?",
    });

    const dates = context.entries.map(
      (item) => item.firstReleaseDate.value ?? "",
    );

    expect([...dates]).toEqual([...dates].sort());
  });

  it("does not truncate at exactly the bound", () => {
    const context = selectContext({
      discography: discographyOf(prolific.slice(0, MAX_CONTEXT_RELEASES)),
      question: "list their albums",
    });

    expect(context.entries).toHaveLength(MAX_CONTEXT_RELEASES);
    expect(context.contextTruncated).toBe(false);
  });
});

describe("the two partial signals are independent", () => {
  it("reports a complete retrieval that was truncated for this question", () => {
    const context = selectContext({
      discography: discographyOf(
        Array.from({ length: 400 }, (_, index) => entry(index + 1)),
        { retrievalComplete: true, total: 400 },
      ),
      question: "list everything",
    });

    expect(context.retrievalComplete).toBe(true);
    expect(context.contextTruncated).toBe(true);
  });

  it("reports a partial retrieval that fitted this question completely", () => {
    const context = selectContext({
      discography: discographyOf([entry(1), entry(2)], {
        retrievalComplete: false,
        total: 288_991,
      }),
      question: "what was their first album?",
    });

    expect(context.retrievalComplete).toBe(false);
    expect(context.contextTruncated).toBe(false);
    // The honest denominator is MusicBrainz's total, not what was retrieved.
    expect(context.totalAvailable).toBe(288_991);
  });
});

describe("counting questions", () => {
  it.each([
    "how many studio albums are recorded here?",
    "what is the total number of releases?",
    "count their EPs",
  ])("recognises %s", (question) => {
    expect(isCountingQuestion(question)).toBe(true);
  });

  it.each([
    "what was their first studio album?",
    "did they release any live albums?",
  ])("does not treat %s as counting", (question) => {
    expect(isCountingQuestion(question)).toBe(false);
  });
});
