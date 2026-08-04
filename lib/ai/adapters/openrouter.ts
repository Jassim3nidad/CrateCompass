import "server-only";

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
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
 * OpenRouter adapter.
 *
 * ## Why the OpenAI SDK rather than `@openrouter/sdk`
 *
 * OpenRouter exposes an OpenAI-compatible `/chat/completions` endpoint, so
 * pointing the already-vendored `openai` client at its base URL reuses the
 * structured-output path this codebase already tests, with no extra
 * dependency. `@openrouter/sdk` would add a second SDK surface for no gain.
 *
 * ## Model constraint
 *
 * The configured model **must** support structured outputs. OpenRouter's free
 * tier does not: filtering its catalogue by `supported_parameters=structured_outputs`
 * returns no model priced at zero. Every call here is schema-constrained, so a
 * free model would have to be prompted for JSON and hoped at — which is exactly
 * what the compliance plan's structured-output requirement rules out.
 *
 * ## Subprocessors
 *
 * OpenRouter is a router, so a request reaches at least two parties that the
 * Anthropic and OpenAI adapters do not involve: OpenRouter itself, and whoever
 * hosts the selected model. `parseMood` and the playlist-text calls carry the
 * user's own words, which is personal data. See ADR 0004.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 4_000;

let cachedClient: OpenAI | undefined;

function getClient(): { client: OpenAI; model: string } {
  const environment = getServerEnvironment();

  if (!environment.OPENROUTER_API_KEY || !environment.OPENROUTER_MODEL) {
    throw new AiProviderError(
      "not-configured",
      "The OpenRouter provider is not configured for this deployment.",
    );
  }

  cachedClient ??= new OpenAI({
    apiKey: environment.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    defaultHeaders: {
      // OpenRouter attributes traffic with these; they are not credentials.
      "HTTP-Referer": environment.NEXT_PUBLIC_APP_URL,
      "X-Title": "CrateCompass",
    },
  });

  return { client: cachedClient, model: environment.OPENROUTER_MODEL };
}

/** Test-only: drop the memoised client so a stubbed SDK is picked up. */
export function resetOpenRouterClientForTesting(): void {
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
      provider: "openrouter",
      operation,
      kind: classified.kind,
      durationMs: Date.now() - startedAt,
    });
    throw classified;
  }

  const choice = completion.choices[0];

  // A routed model can decline; OpenRouter surfaces that as a content refusal
  // rather than an error status.
  if (choice?.message.refusal) {
    logger.warn({ event: "ai.refused", provider: "openrouter", operation });
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

  // Null when the model's JSON did not satisfy the schema. Upstream models
  // behind a router vary in how strictly they honour the constraint, so this is
  // a live path rather than a defensive one.
  if (!choice?.message.parsed) {
    logger.warn({
      event: "ai.invalid_output",
      provider: "openrouter",
      operation,
    });
    throw new AiProviderError(
      "invalid-output",
      "The AI response did not match the expected shape.",
    );
  }

  logger.info({
    event: "ai.request",
    provider: "openrouter",
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

const EXPLANATION_SYSTEM = `You explain why two artists may be related, using only the supplied evidence.
Every claim must trace to a supplied fact; list those facts in groundedIn.
Never assert a collaboration, release, or biographical detail that is not in the evidence.`;

const DISCOGRAPHY_SYSTEM = `You answer questions about an artist's discography using only the supplied releases.
If the supplied releases do not contain the answer, set sufficientContext to false and explain what is missing.
Never state a release date, title, or type that is not present in the supplied data.`;

const PLAYLIST_TEXT_SYSTEM = `You write a short playlist title or description from the listener's own words and their parsed criteria.
Do not name artists or tracks. Do not reference any music service.`;

export function createOpenRouterProvider(): AiProvider {
  const environment = getServerEnvironment();

  return {
    name: "openrouter",
    model: environment.OPENROUTER_MODEL ?? "unconfigured",

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
