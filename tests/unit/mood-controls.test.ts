import { describe, expect, it } from "vitest";

import { fallbackMoodCriteria } from "@/lib/ai/fallbacks";
import type { MoodCriteria } from "@/lib/ai/schemas";
import {
  clampLength,
  DEFAULT_CONTROLS,
  matchesDecades,
  parseDecade,
  PLAYLIST_LENGTH,
  resolveDecades,
  resolveGenres,
  summarizeControls,
} from "@/lib/mood/controls";

/**
 * The rule these tests exist to protect: AI interprets, deterministic code
 * enforces. A listener's explicit setting must beat the model's reading every
 * time, and a control the product cannot honour must be labelled rather than
 * quietly ignored.
 */

function criteriaWith(overrides: Partial<MoodCriteria> = {}): MoodCriteria {
  return { ...fallbackMoodCriteria("rainy commute"), ...overrides };
}

describe("playlist length", () => {
  it("keeps a length inside the supported range", () => {
    expect(clampLength(1)).toBe(PLAYLIST_LENGTH.min);
    expect(clampLength(500)).toBe(PLAYLIST_LENGTH.max);
    expect(clampLength(22)).toBe(22);
  });

  it("falls back rather than producing NaN", () => {
    expect(clampLength(Number.NaN)).toBe(PLAYLIST_LENGTH.default);
  });
});

describe("genre resolution", () => {
  it("uses the model's hints when the listener set none", () => {
    const criteria = criteriaWith({ genreHints: ["trip hop", "downtempo"] });

    expect(resolveGenres(criteria, DEFAULT_CONTROLS)).toEqual([
      "trip hop",
      "downtempo",
    ]);
  });

  it("replaces the model's hints rather than merging with them", () => {
    // A listener who typed "2000s rock" and then chose jazz has changed their
    // mind; blending the two would match neither request.
    const criteria = criteriaWith({ genreHints: ["rock"] });

    expect(
      resolveGenres(criteria, { ...DEFAULT_CONTROLS, genres: ["jazz"] }),
    ).toEqual(["jazz"]);
  });

  it("drops duplicates that differ only by case", () => {
    const criteria = criteriaWith({ genreHints: ["Trip Hop", "trip hop"] });

    expect(resolveGenres(criteria, DEFAULT_CONTROLS)).toEqual(["Trip Hop"]);
  });
});

describe("era parsing", () => {
  it("reads the forms a listener actually types", () => {
    expect(parseDecade("1990s")).toBe(1990);
    expect(parseDecade("2000")).toBe(2000);
    expect(parseDecade("90s")).toBe(1990);
    expect(parseDecade("00s")).toBe(2000);
  });

  it("returns nothing for text that is not an era", () => {
    expect(parseDecade("recently")).toBeNull();
    expect(parseDecade("")).toBeNull();
  });

  it("prefers explicit decades over the model's era hints", () => {
    const criteria = criteriaWith({ eraHints: ["1970s"] });

    expect(
      resolveDecades(criteria, { ...DEFAULT_CONTROLS, decades: [2010] }),
    ).toEqual([2010]);
  });

  it("excludes a release with no year when an era is set", () => {
    // Including an unknown year would be a guess; excluding it is honest.
    expect(matchesDecades(null, [1990])).toBe(false);
    expect(matchesDecades(null, [])).toBe(true);
    expect(matchesDecades("1994", [1990])).toBe(true);
    expect(matchesDecades("2001", [1990])).toBe(false);
  });
});

describe("control summary", () => {
  it("marks controls the product cannot enforce", () => {
    const summary = summarizeControls(criteriaWith(), DEFAULT_CONTROLS);
    const byLabel = new Map(summary.map((entry) => [entry.label, entry]));

    // Energy has no source outside Spotify audio features, which may not
    // inform discovery — so it is shown as a hint, never as a filter.
    expect(byLabel.get("Energy")?.isHintOnly).toBe(true);
    expect(byLabel.get("Mood")?.isHintOnly).toBe(true);

    expect(byLabel.get("Length")?.isHintOnly).toBe(false);
    expect(byLabel.get("Era")?.isHintOnly).toBe(false);
    expect(byLabel.get("Explicit content")?.isHintOnly).toBe(false);
  });

  it("reports visibility as private by default", () => {
    const summary = summarizeControls(criteriaWith(), DEFAULT_CONTROLS);

    expect(summary.find((entry) => entry.label === "Visibility")?.value).toBe(
      "Private",
    );
  });
});
