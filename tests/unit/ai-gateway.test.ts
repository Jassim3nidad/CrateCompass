import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AiBoundaryViolationError, buildAiInput } from "@/lib/ai/gateway";
import {
  fallbackArtistMatchExplanation,
  fallbackDiscographyAnswer,
  fallbackMoodCriteria,
  fallbackPlaylistDescription,
  fallbackPlaylistTitle,
} from "@/lib/ai/fallbacks";
import {
  answerDiscographyQuestionInputSchema,
  artistMatchExplanationSchema,
  discographyAnswerSchema,
  explainArtistMatchInputSchema,
  moodCriteriaSchema,
  parseMoodInputSchema,
  playlistDescriptionSchema,
  playlistTitleSchema,
  MAX_USER_TEXT_LENGTH,
} from "@/lib/ai/schemas";

/**
 * Schema and provenance enforcement. The recursive content scan carried over
 * from Phase 3 is covered in ai-input-guard.test.ts.
 */

describe("exact-schema parsing", () => {
  it("returns the parsed clone, not the caller's object", () => {
    const input = { moodText: "late night driving" };
    const result = buildAiInput(parseMoodInputSchema, input);

    expect(result).toEqual(input);
    // Callers must send what the gateway returns. If it returned the original
    // reference, an extra property hung off it would ride along.
    expect(result).not.toBe(input);
  });

  it("rejects an unknown field rather than silently stripping it", () => {
    // The whole point of `.strict()`: a Spotify field cannot travel even if the
    // recursive scan does not recognise its name.
    expect(() =>
      buildAiInput(parseMoodInputSchema, {
        moodText: "hello",
        seedTrackReference: "some-internal-id",
      }),
    ).toThrow(AiBoundaryViolationError);
  });

  it("reports the offending path without echoing the value", () => {
    try {
      buildAiInput(parseMoodInputSchema, { moodText: "x", secret: "hunter2" });
      expect.unreachable("unknown key should have been rejected");
    } catch (error) {
      const violation = error as AiBoundaryViolationError;
      expect(violation.reason).toBe("schema-rejected");
      expect(violation.message).not.toContain("hunter2");
    }
  });

  it("caps user text length before it reaches a provider", () => {
    expect(() =>
      buildAiInput(parseMoodInputSchema, {
        moodText: "a".repeat(MAX_USER_TEXT_LENGTH + 1),
      }),
    ).toThrow(AiBoundaryViolationError);
  });

  it("rejects an empty mood rather than sending a blank prompt", () => {
    expect(() =>
      buildAiInput(parseMoodInputSchema, { moodText: "   " }),
    ).toThrow(AiBoundaryViolationError);
  });
});

describe("evidence provenance", () => {
  const base = {
    seedArtistName: "Portishead",
    candidateArtistName: "Massive Attack",
    listenerPreference: null,
    candidateReleases: [],
  };

  it("accepts evidence from approved sources", () => {
    const result = buildAiInput(explainArtistMatchInputSchema, {
      ...base,
      evidence: [
        { source: "musicbrainz", statement: "Both formed in Bristol." },
        { source: "listenbrainz", statement: "Frequently heard together." },
      ],
    });

    expect(result.evidence).toHaveLength(2);
  });

  it("makes Spotify-sourced evidence unrepresentable", () => {
    expect(() =>
      buildAiInput(explainArtistMatchInputSchema, {
        ...base,
        evidence: [{ source: "spotify", statement: "Appears on a playlist." }],
      }),
    ).toThrow(AiBoundaryViolationError);
  });

  it("rejects an unknown source rather than defaulting to allowed", () => {
    expect(() =>
      buildAiInput(explainArtistMatchInputSchema, {
        ...base,
        evidence: [{ source: "some-new-provider", statement: "x" }],
      }),
    ).toThrow(AiBoundaryViolationError);
  });

  it("requires at least one supporting fact", () => {
    expect(() =>
      buildAiInput(explainArtistMatchInputSchema, { ...base, evidence: [] }),
    ).toThrow(AiBoundaryViolationError);
  });

  it("accepts the listener's own words alongside the evidence", () => {
    const result = buildAiInput(explainArtistMatchInputSchema, {
      ...base,
      listenerPreference: "I like the slow, heavy low end.",
      evidence: [
        { source: "musicbrainz", statement: "Both formed in Bristol." },
      ],
    });

    expect(result.listenerPreference).toBe("I like the slow, heavy low end.");
  });

  it("rejects a Spotify link pasted into the listener's own words", () => {
    expect(() =>
      buildAiInput(explainArtistMatchInputSchema, {
        ...base,
        listenerPreference: "like https://open.spotify.com/artist/abc",
        evidence: [{ source: "musicbrainz", statement: "Formed in Bristol." }],
      }),
    ).toThrow(AiBoundaryViolationError);
  });

  it("rejects a candidate release carrying a Spotify identifier", () => {
    expect(() =>
      buildAiInput(explainArtistMatchInputSchema, {
        ...base,
        evidence: [{ source: "musicbrainz", statement: "Formed in Bristol." }],
        candidateReleases: [
          {
            id: "rg-1",
            title: "Dummy",
            primaryType: "Album",
            year: "1994",
            spotifyAlbumId: "abc123",
          },
        ],
      }),
    ).toThrow(AiBoundaryViolationError);
  });
});

describe("discography input", () => {
  it("accepts MusicBrainz-shaped releases", () => {
    const result = buildAiInput(answerDiscographyQuestionInputSchema, {
      question: "When did Dummy come out?",
      artistName: "Portishead",
      releases: [
        {
          id: "rg-1",
          title: "Dummy",
          primaryType: "Album",
          firstReleaseDate: "1994-08-22",
        },
      ],
    });

    expect(result.releases[0]?.title).toBe("Dummy");
  });

  it("rejects a release carrying an extra identifier field", () => {
    expect(() =>
      buildAiInput(answerDiscographyQuestionInputSchema, {
        question: "x",
        artistName: "y",
        releases: [
          {
            id: "rg-1",
            title: "Dummy",
            primaryType: "Album",
            firstReleaseDate: "1994-08-22",
            spotifyAlbumId: "abc123",
          },
        ],
      }),
    ).toThrow(AiBoundaryViolationError);
  });
});

describe("output schemas", () => {
  it("rejects an explanation that cites nothing", () => {
    // An explanation grounded in no supplied fact is unsupported by
    // construction, whatever it says.
    const result = artistMatchExplanationSchema.safeParse({
      explanation: "They just sound similar.",
      sharedCharacteristics: [],
      contrast: null,
      startingPointReleaseId: null,
      groundedIn: [],
      confidence: "high",
    });

    expect(result.success).toBe(false);
  });

  it("treats insufficient context as a valid answer", () => {
    const result = discographyAnswerSchema.safeParse({
      sufficientContext: false,
      answer: "",
      citedReleaseIds: [],
      unansweredReason: "The supplied releases do not cover that year.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an out-of-range enum value", () => {
    // The Anthropic SDK sends enums as advisory descriptions rather than
    // enforced constraints, so this is a live path, not a defensive one.
    const result = moodCriteriaSchema.safeParse({
      ...fallbackMoodCriteria("test"),
      energyLevel: "extremely high",
    });

    expect(result.success).toBe(false);
  });
});

describe("deterministic fallbacks", () => {
  it("produces mood criteria that satisfy the schema", () => {
    expect(
      moodCriteriaSchema.safeParse(fallbackMoodCriteria("rainy sunday"))
        .success,
    ).toBe(true);
  });

  it("asks for clarification rather than inventing criteria", () => {
    const fallback = fallbackMoodCriteria("something for tonight");

    expect(fallback.clarificationNeeded).toBe(true);
    expect(fallback.genreHints).toEqual([]);
    expect(fallback.eraHints).toEqual([]);
  });

  it("produces an explanation that names only its sources", () => {
    const fallback = fallbackArtistMatchExplanation([
      { source: "listenbrainz", statement: "Listened to together." },
    ]);

    expect(artistMatchExplanationSchema.safeParse(fallback).success).toBe(true);
    expect(fallback.confidence).toBe("low");
    expect(fallback.explanation).toContain("listenbrainz");
  });

  it("reports insufficient context rather than answering from nothing", () => {
    const fallback = fallbackDiscographyAnswer();

    expect(discographyAnswerSchema.safeParse(fallback).success).toBe(true);
    expect(fallback.sufficientContext).toBe(false);
    expect(fallback.answer).toBe("");
  });

  it("produces playlist text that satisfies its schemas", () => {
    const criteria = fallbackMoodCriteria("hazy summer evening");

    expect(
      playlistTitleSchema.safeParse(
        fallbackPlaylistTitle("hazy summer evening"),
      ).success,
    ).toBe(true);
    expect(
      playlistDescriptionSchema.safeParse(fallbackPlaylistDescription(criteria))
        .success,
    ).toBe(true);
  });

  it("keeps a very long mood inside the title limit", () => {
    const title = fallbackPlaylistTitle("z".repeat(500));
    expect(playlistTitleSchema.safeParse(title).success).toBe(true);
  });
});

describe("gateway generality", () => {
  it("works with any strict schema, not just the AI ones", () => {
    const schema = z.object({ a: z.string() }).strict();

    expect(buildAiInput(schema, { a: "ok" })).toEqual({ a: "ok" });
    expect(() => buildAiInput(schema, { a: "ok", b: 1 })).toThrow(
      AiBoundaryViolationError,
    );
  });
});
