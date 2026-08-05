import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

import { describeProviderFailure } from "@/lib/ai/diagnostics";
import { buildAiInput } from "@/lib/ai/gateway";
import {
  EXPLANATION_SYSTEM,
  explainArtistMatchUserContent,
} from "@/lib/ai/prompts";
import {
  AiProviderError,
  type AiProvider,
  type AnswerDiscographyQuestionInput,
  type ExplainArtistMatchInput,
  type GeneratePlaylistTextInput,
  type ParseMoodInput,
} from "@/lib/ai/provider";
import {
  answerDiscographyQuestionInputSchema,
  artistMatchExplanationSchema,
  discographyAnswerSchema,
  explainArtistMatchInputSchema,
  generatePlaylistTextInputSchema,
  moodCriteriaSchema,
  parseMoodInputSchema,
  playlistDescriptionSchema,
  playlistTitleSchema,
} from "@/lib/ai/schemas";
import { getServerEnvironment } from "@/lib/env";
import { logger } from "@/lib/observability/logger";

/**
 * Google AI Studio (Gemini) adapter — the zero-cost option.
 *
 * ## Why this exists
 *
 * Gemini's free tier requires no billing account ("no billing setup
 * necessary"), which the Anthropic, OpenAI and OpenRouter paths all do. For a
 * $0.00 budget this is the only provider that runs the design as written.
 *
 * ## Why the OpenAI client
 *
 * Google publishes an OpenAI-compatible endpoint that accepts
 * `response_format` with a JSON schema, so the structured-output path already
 * exercised by the OpenRouter adapter works unchanged. No new dependency, and
 * one less code path to test.
 *
 * ## The trade that is not money
 *
 * Google states that free-tier content **is used to improve their products**,
 * unlike the paid tier. `parseMood`, the playlist-text calls and
 * `answerDiscographyQuestion` all carry the user's own words, so on this
 * provider that text becomes training data. That is a privacy-notice
 * obligation, not a cost one. See ADR 0005.
 */

const GEMINI_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 4_000;

let cachedClient: OpenAI | undefined;

function getClient(): { client: OpenAI; model: string } {
  const environment = getServerEnvironment();

  if (!environment.GEMINI_API_KEY || !environment.GEMINI_MODEL) {
    throw new AiProviderError(
      "not-configured",
      "The Gemini provider is not configured for this deployment.",
    );
  }

  cachedClient ??= new OpenAI({
    apiKey: environment.GEMINI_API_KEY,
    baseURL: GEMINI_OPENAI_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  return { client: cachedClient, model: environment.GEMINI_MODEL };
}

/** Test-only: drop the memoised client so a stubbed SDK is picked up. */
export function resetGeminiClientForTesting(): void {
  cachedClient = undefined;
}

function classify(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AiProviderError("timeout", "The AI provider timed out.");
  }
  if (error instanceof OpenAI.RateLimitError) {
    // Expected on a free tier with per-minute and per-day caps. Recoverable,
    // so the caller falls back deterministically rather than failing hard.
    return new AiProviderError(
      "rate-limited",
      "The free AI quota is exhausted for now. Try again shortly.",
    );
  }
  if (error instanceof OpenAI.AuthenticationError) {
    return new AiProviderError(
      "not-configured",
      "The AI provider rejected the configured credentials.",
      { fallbackEligible: false },
    );
  }

  return new AiProviderError("unavailable", "The AI provider is unavailable.");
}

async function complete<Schema extends z.ZodType>(
  operation: string,
  schema: Schema,
  system: string,
  userContent: string,
): Promise<z.infer<Schema>> {
  const { client, model } = getClient();
  const startedAt = Date.now();

  let completion;
  try {
    completion = await client.chat.completions.parse({
      model,
      max_tokens: MAX_TOKENS,
      response_format: zodResponseFormat(schema, operation),
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    });
  } catch (error) {
    const classified = classify(error);
    logger.warn({
      event: "ai.request_failed",
      provider: "gemini",
      operation,
      kind: classified.kind,
      // Redacted transport detail. Without it, a classified failure is
      // indistinguishable from any other and cannot be diagnosed from logs.
      ...describeProviderFailure(error),
      durationMs: Date.now() - startedAt,
    });
    throw classified;
  }

  const choice = completion.choices[0];

  if (choice?.message.refusal) {
    logger.warn({ event: "ai.refused", provider: "gemini", operation });
    throw new AiProviderError(
      "refused",
      "The AI provider declined to answer this request.",
    );
  }

  if (choice?.finish_reason === "length") {
    throw new AiProviderError(
      "invalid-output",
      "The AI response was cut off before it completed.",
    );
  }

  if (!choice?.message.parsed) {
    logger.warn({
      event: "ai.invalid_output",
      provider: "gemini",
      operation,
    });
    throw new AiProviderError(
      "invalid-output",
      "The AI response did not match the expected shape.",
    );
  }

  logger.info({
    event: "ai.request",
    provider: "gemini",
    operation,
    model,
    durationMs: Date.now() - startedAt,
    inputTokens: completion.usage?.prompt_tokens,
    outputTokens: completion.usage?.completion_tokens,
  });

  return choice.message.parsed as z.infer<Schema>;
}

const MOOD_SYSTEM = `You convert a listener's own description of a mood into structured discovery criteria.
Use only what the listener wrote. Do not invent artists, genres, or eras they did not imply.
If the description is too vague to yield useful criteria, set clarificationNeeded to true and ask one specific question.`;

const DISCOGRAPHY_SYSTEM = `You answer questions about an artist's discography using only the supplied releases.
If the supplied releases do not contain the answer, set sufficientContext to false and explain what is missing.
Never state a release date, title, or type that is not present in the supplied data.`;

const PLAYLIST_TEXT_SYSTEM = `You write a short playlist title or description from the listener's own words and their parsed criteria.
Do not name artists or tracks. Do not reference any music service.`;

export function createGeminiProvider(): AiProvider {
  const environment = getServerEnvironment();

  return {
    name: "gemini",
    model: environment.GEMINI_MODEL ?? "unconfigured",

    async parseMood(input: ParseMoodInput) {
      const safe = buildAiInput(parseMoodInputSchema, input);
      return complete(
        "mood_criteria",
        moodCriteriaSchema,
        MOOD_SYSTEM,
        `Listener's description:\n${safe.moodText}`,
      );
    },

    async explainArtistMatch(input: ExplainArtistMatchInput) {
      const safe = buildAiInput(explainArtistMatchInputSchema, input);

      return complete(
        "artist_match_explanation",
        artistMatchExplanationSchema,
        EXPLANATION_SYSTEM,
        explainArtistMatchUserContent(safe),
      );
    },

    async answerDiscographyQuestion(input: AnswerDiscographyQuestionInput) {
      const safe = buildAiInput(answerDiscographyQuestionInputSchema, input);
      const releases = safe.releases
        .map(
          (release) =>
            `- id=${release.id} | ${release.title} | ${release.primaryType ?? "unknown type"} | ${release.firstReleaseDate ?? "date unknown"}`,
        )
        .join("\n");

      return complete(
        "discography_answer",
        discographyAnswerSchema,
        DISCOGRAPHY_SYSTEM,
        `Artist: ${safe.artistName}\nQuestion: ${safe.question}\n\nReleases:\n${releases}`,
      );
    },

    async generatePlaylistTitle(input: GeneratePlaylistTextInput) {
      const safe = buildAiInput(generatePlaylistTextInputSchema, input);
      return complete(
        "playlist_title",
        playlistTitleSchema,
        PLAYLIST_TEXT_SYSTEM,
        `Write a title.\nListener's words: ${safe.moodText}\nPrimary mood: ${safe.criteria.primaryMood}`,
      );
    },

    async generatePlaylistDescription(input: GeneratePlaylistTextInput) {
      const safe = buildAiInput(generatePlaylistTextInputSchema, input);
      return complete(
        "playlist_description",
        playlistDescriptionSchema,
        PLAYLIST_TEXT_SYSTEM,
        `Write a description.\nListener's words: ${safe.moodText}\nPrimary mood: ${safe.criteria.primaryMood}\nGenre hints: ${safe.criteria.genreHints.join(", ") || "none"}`,
      );
    },
  };
}
