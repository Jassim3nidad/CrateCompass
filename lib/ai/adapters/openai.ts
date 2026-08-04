import "server-only";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

import { buildAiInput } from "@/lib/ai/gateway";
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
 * OpenAI adapter, implementing the same port as the Anthropic one.
 *
 * Uses the Responses API with structured outputs. Unlike the Anthropic path,
 * OpenAI's `zodTextFormat` emits `strict: true` JSON Schema, so enum
 * constraints are enforced server-side rather than being advisory — but the
 * client-side parse is still the contract, because a refusal or an incomplete
 * response yields no parsed object at all.
 */

const REQUEST_TIMEOUT_MS = 30_000;

let cachedClient: OpenAI | undefined;

function getClient(): { client: OpenAI; model: string } {
  const environment = getServerEnvironment();

  if (!environment.OPENAI_API_KEY || !environment.OPENAI_MODEL) {
    throw new AiProviderError(
      "not-configured",
      "The OpenAI provider is not configured for this deployment.",
    );
  }

  cachedClient ??= new OpenAI({
    apiKey: environment.OPENAI_API_KEY,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  return { client: cachedClient, model: environment.OPENAI_MODEL };
}

/** Test-only: drop the memoised client so a stubbed SDK is picked up. */
export function resetOpenAiClientForTesting(): void {
  cachedClient = undefined;
}

function classify(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AiProviderError("timeout", "The AI provider timed out.");
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new AiProviderError(
      "rate-limited",
      "The AI provider is rate limiting requests.",
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

  let response;
  try {
    response = await client.responses.parse({
      model,
      instructions: system,
      input: userContent,
      text: { format: zodTextFormat(schema, operation) },
    });
  } catch (error) {
    const classified = classify(error);
    logger.warn({
      event: "ai.request_failed",
      provider: "openai",
      operation,
      kind: classified.kind,
      durationMs: Date.now() - startedAt,
    });
    throw classified;
  }

  if (response.status === "incomplete") {
    throw new AiProviderError(
      "invalid-output",
      "The AI response was cut off before it completed.",
    );
  }

  if (!response.output_parsed) {
    logger.warn({
      event: "ai.invalid_output",
      provider: "openai",
      operation,
    });
    throw new AiProviderError(
      "invalid-output",
      "The AI response did not match the expected shape.",
    );
  }

  logger.info({
    event: "ai.request",
    provider: "openai",
    operation,
    durationMs: Date.now() - startedAt,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  });

  return response.output_parsed as z.infer<Schema>;
}

const MOOD_SYSTEM = `You convert a listener's own description of a mood into structured discovery criteria.
Use only what the listener wrote. Do not invent artists, genres, or eras they did not imply.
If the description is too vague to yield useful criteria, set clarificationNeeded to true and ask one specific question.`;

const EXPLANATION_SYSTEM = `You explain why two artists may be related, using only the supplied evidence.
Every claim must trace to a supplied fact; list those facts in groundedIn.
Never assert a collaboration, release, or biographical detail that is not in the evidence.`;

const DISCOGRAPHY_SYSTEM = `You answer questions about an artist's discography using only the supplied releases.
If the supplied releases do not contain the answer, set sufficientContext to false and explain what is missing.
Never state a release date, title, or type that is not present in the supplied data.`;

const PLAYLIST_TEXT_SYSTEM = `You write a short playlist title or description from the listener's own words and their parsed criteria.
Do not name artists or tracks. Do not reference any music service.`;

export function createOpenAiProvider(): AiProvider {
  const environment = getServerEnvironment();

  return {
    name: "openai",
    model: environment.OPENAI_MODEL ?? "unconfigured",

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
      const evidence = safe.evidence
        .map((fact) => `- [${fact.source}] ${fact.statement}`)
        .join("\n");

      return complete(
        "artist_match_explanation",
        artistMatchExplanationSchema,
        EXPLANATION_SYSTEM,
        `Seed artist: ${safe.seedArtistName}\nCandidate artist: ${safe.candidateArtistName}\n\nEvidence:\n${evidence}`,
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
