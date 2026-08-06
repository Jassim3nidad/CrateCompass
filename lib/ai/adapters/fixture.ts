import "server-only";

import type {
  AiProvider,
  AnswerDiscographyQuestionInput,
  ExplainArtistMatchInput,
  GeneratePlaylistTextInput,
  ParseMoodInput,
} from "@/lib/ai/provider";
import { buildAiInput } from "@/lib/ai/gateway";
import {
  answerDiscographyQuestionInputSchema,
  explainArtistMatchInputSchema,
  generatePlaylistTextInputSchema,
  parseMoodInputSchema,
} from "@/lib/ai/schemas";

/**
 * A deterministic AI provider for the end-to-end suite.
 *
 * Browser tests cannot use a real model: responses vary between runs, a real
 * key would be spent on every test run, and on the free Gemini tier the test's
 * own text would become training data. This returns fixed, schema-valid output
 * instead.
 *
 * What it does **not** skip: every method still calls `buildAiInput`, so the
 * boundary gateway runs exactly as it does in production. A test that
 * accidentally routes Spotify content into an AI call fails here the same way
 * it would live — which is the property most worth preserving in a fake.
 *
 * Reachable only when `PROVIDER_FIXTURES=1` and `APP_ENV=test`.
 */
export function createFixtureAiProvider(): AiProvider {
  return {
    name: "gemini",
    model: "fixture-model",

    async parseMood(input: ParseMoodInput) {
      const safe = buildAiInput(parseMoodInputSchema, input);

      // "vague" is the trigger for the clarification path, so a test can reach
      // that branch without depending on a model's judgement.
      const needsClarification = /vague|something|whatever/i.test(
        safe.moodText,
      );

      return {
        primaryMood: safe.moodText.slice(0, 120),
        secondaryMoods: [],
        energyLevel: "medium" as const,
        tempoPreference: "any" as const,
        valencePreference: "any" as const,
        // Matches the fixture catalogue so tag search returns seeds.
        genreHints: needsClarification ? [] : ["post-rock"],
        eraHints: [],
        languagePreferences: [],
        instrumentalPreference: "any" as const,
        vocalPreference: "any" as const,
        activity: null,
        explicitContentPreference: "any" as const,
        avoidTerms: [],
        clarificationNeeded: needsClarification,
        clarificationQuestion: needsClarification
          ? "Which genres should this lean towards?"
          : null,
      };
    },

    async explainArtistMatch(input: ExplainArtistMatchInput) {
      const safe = buildAiInput(explainArtistMatchInputSchema, input);
      const first = safe.evidence[0];

      return {
        explanation: `${safe.seedArtistName} and ${safe.candidateArtistName} share the characteristics recorded below.`,
        sharedCharacteristics: ["shared tags"],
        contrast: null,
        startingPointReleaseId: null,
        // Echoing a supplied statement keeps the grounding verifier meaningful:
        // the fixture passes the same check a real answer must pass.
        groundedIn: [first?.statement ?? "no evidence supplied"],
        confidence: "medium" as const,
      };
    },

    async answerDiscographyQuestion(input: AnswerDiscographyQuestionInput) {
      const safe = buildAiInput(answerDiscographyQuestionInputSchema, input);
      const first = safe.releases[0];

      return {
        sufficientContext: first !== undefined,
        answer: first ? `${safe.artistName} released ${first.title}.` : "",
        citedReleaseIds: first ? [first.id] : [],
        unansweredReason: first
          ? null
          : "No releases were supplied for that artist.",
      };
    },

    async generatePlaylistTitle(input: GeneratePlaylistTextInput) {
      const safe = buildAiInput(generatePlaylistTextInputSchema, input);
      return {
        title: `Fixture playlist — ${safe.criteria.primaryMood}`.slice(0, 80),
      };
    },

    async generatePlaylistDescription(input: GeneratePlaylistTextInput) {
      const safe = buildAiInput(generatePlaylistTextInputSchema, input);
      return {
        description: `Built for a ${safe.criteria.primaryMood} moment.`.slice(
          0,
          280,
        ),
      };
    },
  };
}
