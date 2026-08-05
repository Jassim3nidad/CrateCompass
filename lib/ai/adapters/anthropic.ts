import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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
 * Anthropic adapter.
 *
 * Three model-specific decisions, all consequences of running on Claude Opus 5:
 *
 * - **Thinking stays on.** It is the default on this model, and disabling it
 *   risks internal tags leaking into the visible response — which for a
 *   structured-output call means a schema failure. Cost is controlled with
 *   `output_config.effort` instead, which is the supported lever.
 * - **`max_tokens` is generous.** It caps thinking *and* response text
 *   together, so a value sized to the JSON alone truncates mid-answer.
 * - **No sampling parameters.** `temperature`, `top_p` and `top_k` are rejected
 *   with a 400 on this model. Determinism comes from the schema and the prompt.
 */

const MAX_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Short extraction work does not need deep reasoning; grounded answers do. */
type Effort = "low" | "medium";

let cachedClient: Anthropic | undefined;

function getClient(): { client: Anthropic; model: string } {
  const environment = getServerEnvironment();

  if (!environment.ANTHROPIC_API_KEY || !environment.ANTHROPIC_MODEL) {
    throw new AiProviderError(
      "not-configured",
      "The Anthropic provider is not configured for this deployment.",
    );
  }

  cachedClient ??= new Anthropic({
    apiKey: environment.ANTHROPIC_API_KEY,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  return { client: cachedClient, model: environment.ANTHROPIC_MODEL };
}

/** Test-only: drop the memoised client so a stubbed SDK is picked up. */
export function resetAnthropicClientForTesting(): void {
  cachedClient = undefined;
}

function classify(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError("timeout", "The AI provider timed out.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError(
      "rate-limited",
      "The AI provider is rate limiting requests.",
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiProviderError(
      "not-configured",
      "The AI provider rejected the configured credentials.",
      { fallbackEligible: false },
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new AiProviderError(
      "unavailable",
      "The AI provider is unavailable.",
    );
  }

  return new AiProviderError("unavailable", "The AI provider is unavailable.");
}

async function complete<Schema extends z.ZodType>(
  operation: string,
  schema: Schema,
  effort: Effort,
  system: string,
  userContent: string,
): Promise<z.infer<Schema>> {
  const { client, model } = getClient();
  const startedAt = Date.now();

  let response;
  try {
    response = await client.messages.parse({
      model,
      max_tokens: MAX_TOKENS,
      output_config: {
        effort,
        // This SDK version's helper takes the schema alone — no name argument.
        format: zodOutputFormat(schema),
      },
      system,
      messages: [{ role: "user", content: userContent }],
    });
  } catch (error) {
    const classified = classify(error);
    logger.warn({
      event: "ai.request_failed",
      provider: "anthropic",
      operation,
      kind: classified.kind,
      // Redacted transport detail. Without it, a classified failure is
      // indistinguishable from any other and cannot be diagnosed from logs.
      ...describeProviderFailure(error),
      durationMs: Date.now() - startedAt,
    });
    throw classified;
  }

  // Safety classifiers can decline a request and still return HTTP 200 with an
  // empty content array. Reading the parsed output first would look like a
  // malformed response rather than a refusal.
  if (response.stop_reason === "refusal") {
    logger.warn({
      event: "ai.refused",
      provider: "anthropic",
      operation,
      category: response.stop_details?.category ?? null,
    });
    throw new AiProviderError(
      "refused",
      "The AI provider declined to answer this request.",
    );
  }

  if (response.stop_reason === "max_tokens") {
    // Output is truncated, so any JSON in it is incomplete by definition.
    throw new AiProviderError(
      "invalid-output",
      "The AI response was cut off before it completed.",
    );
  }

  // `parsed_output` is null when the model's JSON did not satisfy the schema.
  // The enum constraint in particular is advisory on the wire, so this is a
  // real path rather than a defensive one.
  if (!response.parsed_output) {
    logger.warn({
      event: "ai.invalid_output",
      provider: "anthropic",
      operation,
    });
    throw new AiProviderError(
      "invalid-output",
      "The AI response did not match the expected shape.",
    );
  }

  logger.info({
    event: "ai.request",
    provider: "anthropic",
    operation,
    effort,
    durationMs: Date.now() - startedAt,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return response.parsed_output as z.infer<Schema>;
}

const MOOD_SYSTEM = `You convert a listener's own description of a mood into structured discovery criteria.
Use only what the listener wrote. Do not invent artists, genres, or eras they did not imply.
If the description is too vague to yield useful criteria, set clarificationNeeded to true and ask one specific question.`;

const DISCOGRAPHY_SYSTEM = `You answer questions about an artist's discography using only the supplied releases.
If the supplied releases do not contain the answer, set sufficientContext to false and explain what is missing.
Never state a release date, title, or type that is not present in the supplied data.`;

const PLAYLIST_TEXT_SYSTEM = `You write a short playlist title or description from the listener's own words and their parsed criteria.
Do not name artists or tracks. Do not reference any music service.`;

export function createAnthropicProvider(): AiProvider {
  const environment = getServerEnvironment();

  return {
    name: "anthropic",
    model: environment.ANTHROPIC_MODEL ?? "unconfigured",

    async parseMood(input: ParseMoodInput) {
      const safe = buildAiInput(parseMoodInputSchema, input);
      return complete(
        "mood_criteria",
        moodCriteriaSchema,
        "low",
        MOOD_SYSTEM,
        `Listener's description:\n${safe.moodText}`,
      );
    },

    async explainArtistMatch(input: ExplainArtistMatchInput) {
      const safe = buildAiInput(explainArtistMatchInputSchema, input);

      return complete(
        "artist_match_explanation",
        artistMatchExplanationSchema,
        "medium",
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
        "medium",
        DISCOGRAPHY_SYSTEM,
        `Artist: ${safe.artistName}\nQuestion: ${safe.question}\n\nReleases:\n${releases}`,
      );
    },

    async generatePlaylistTitle(input: GeneratePlaylistTextInput) {
      const safe = buildAiInput(generatePlaylistTextInputSchema, input);
      return complete(
        "playlist_title",
        playlistTitleSchema,
        "low",
        PLAYLIST_TEXT_SYSTEM,
        `Write a title.\nListener's words: ${safe.moodText}\nPrimary mood: ${safe.criteria.primaryMood}`,
      );
    },

    async generatePlaylistDescription(input: GeneratePlaylistTextInput) {
      const safe = buildAiInput(generatePlaylistTextInputSchema, input);
      return complete(
        "playlist_description",
        playlistDescriptionSchema,
        "low",
        PLAYLIST_TEXT_SYSTEM,
        `Write a description.\nListener's words: ${safe.moodText}\nPrimary mood: ${safe.criteria.primaryMood}\nGenre hints: ${safe.criteria.genreHints.join(", ") || "none"}`,
      );
    },
  };
}
