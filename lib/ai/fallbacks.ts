import type {
  ArtistMatchExplanation,
  DiscographyAnswer,
  MoodCriteria,
  PlaylistDescription,
  PlaylistTitle,
} from "@/lib/ai/schemas";

/**
 * Deterministic outputs used when a provider is unavailable, refuses, or
 * returns something that fails schema validation.
 *
 * The rule these follow: **degrade to honest, never to invented.** A fallback
 * may restate what the user typed or what a provider supplied; it may not
 * assert a musical fact, a relationship, or a release date. So the mood
 * fallback asks for clarification rather than guessing criteria, and the
 * discography fallback reports insufficient context rather than answering from
 * nothing.
 */

export function fallbackMoodCriteria(moodText: string): MoodCriteria {
  return {
    // Echoing the user's own words is safe; inferring criteria from them is not.
    primaryMood: moodText.slice(0, 120),
    secondaryMoods: [],
    energyLevel: "medium",
    tempoPreference: "any",
    valencePreference: "any",
    genreHints: [],
    eraHints: [],
    languagePreferences: [],
    instrumentalPreference: "any",
    vocalPreference: "any",
    activity: null,
    explicitContentPreference: "any",
    avoidTerms: [],
    clarificationNeeded: true,
    clarificationQuestion:
      "Mood interpretation is unavailable right now. Which artists or genres should this lean towards?",
  };
}

export function fallbackArtistMatchExplanation(
  evidence: readonly { readonly source: string; readonly statement: string }[],
): ArtistMatchExplanation {
  const sources = [...new Set(evidence.map((fact) => fact.source))];

  return {
    // States only that a relationship was reported, and by whom. It does not
    // characterise the music, which is the part that would be fabrication.
    explanation:
      sources.length > 0
        ? `A written explanation is unavailable right now. This relationship was reported by ${sources.join(" and ")}.`
        : "A written explanation is unavailable right now, and no supporting evidence was supplied.",
    sharedCharacteristics: [],
    contrast: null,
    // Never guessed: suggesting a starting release with no model output behind
    // it would be this module inventing exactly what it exists to avoid.
    startingPointReleaseId: null,
    // `groundedIn` and `statement` share a 400-character ceiling, so a supplied
    // fact always fits without truncation.
    groundedIn: evidence.slice(0, 10).map((fact) => fact.statement),
    confidence: "low",
  };
}

export function fallbackDiscographyAnswer(): DiscographyAnswer {
  return {
    sufficientContext: false,
    answer: "",
    citedReleaseIds: [],
    unansweredReason:
      "Answering is unavailable right now. The discography below is still accurate and browsable.",
  };
}

export function fallbackPlaylistTitle(moodText: string): PlaylistTitle {
  const trimmed = moodText.trim().replace(/\s+/g, " ");
  return { title: trimmed.length > 0 ? trimmed.slice(0, 80) : "CrateCompass" };
}

export function fallbackPlaylistDescription(
  criteria: MoodCriteria,
): PlaylistDescription {
  const hints = criteria.genreHints.slice(0, 3).join(", ");

  return {
    description: hints
      ? `Created with CrateCompass from a ${criteria.primaryMood} prompt (${hints}).`.slice(
          0,
          280,
        )
      : `Created with CrateCompass from a ${criteria.primaryMood} prompt.`.slice(
          0,
          280,
        ),
  };
}
