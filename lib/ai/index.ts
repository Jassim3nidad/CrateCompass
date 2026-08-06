import "server-only";

import { createAnthropicProvider } from "@/lib/ai/adapters/anthropic";
import { createFixtureAiProvider } from "@/lib/ai/adapters/fixture";
import { createOpenAiProvider } from "@/lib/ai/adapters/openai";
import { createGeminiProvider } from "@/lib/ai/adapters/gemini";
import { createOpenRouterProvider } from "@/lib/ai/adapters/openrouter";
import {
  fallbackArtistMatchExplanation,
  fallbackDiscographyAnswer,
  fallbackMoodCriteria,
  fallbackPlaylistDescription,
  fallbackPlaylistTitle,
} from "@/lib/ai/fallbacks";
import { AiUsageLimitError, claimAiUsage } from "@/lib/ai/limits";
import { AiProviderError, type AiProvider } from "@/lib/ai/provider";
import { logger } from "@/lib/observability/logger";
import { getServerEnvironment } from "@/lib/env";
import { areProviderFixturesEnabled } from "@/lib/providers/fixtures/enabled";

/**
 * The entry point product code uses.
 *
 * `getAiProvider()` returns the raw adapter for the configured provider.
 * `getAiProviderForUser()` wraps it with the two things every real call needs:
 * a usage claim before the request, and a deterministic fallback after a
 * recoverable failure.
 *
 * A usage-limit refusal deliberately does **not** fall back. Falling back would
 * hand the user a result and hide the fact that they hit their allowance, which
 * makes the limit invisible and unactionable.
 */

export function getAiProvider(): AiProvider {
  // Same gate as the music providers: a real model in an automated test would
  // vary between runs, spend a key, and on the free tier feed the test's own
  // text into training data.
  if (areProviderFixturesEnabled()) {
    return createFixtureAiProvider();
  }

  const environment = getServerEnvironment();

  switch (environment.AI_PROVIDER) {
    case "gemini":
      return createGeminiProvider();
    case "anthropic":
      return createAnthropicProvider();
    case "openrouter":
      return createOpenRouterProvider();
    case "openai":
      return createOpenAiProvider();
  }
}

async function withFallback<T>(
  operation: string,
  attempt: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof AiUsageLimitError) {
      throw error;
    }

    if (error instanceof AiProviderError && error.fallbackEligible) {
      logger.warn({
        event: "ai.fallback_used",
        operation,
        kind: error.kind,
      });
      return fallback();
    }

    throw error;
  }
}

export function getAiProviderForUser(userId: string): AiProvider {
  const provider = getAiProvider();

  const claim = (operation: string) =>
    claimAiUsage({ userId, provider: provider.name, operation });

  return {
    name: provider.name,
    model: provider.model,

    async parseMood(input) {
      await claim("parseMood");
      return withFallback(
        "parseMood",
        () => provider.parseMood(input),
        () => fallbackMoodCriteria(input.moodText),
      );
    },

    async explainArtistMatch(input) {
      await claim("explainArtistMatch");
      return withFallback(
        "explainArtistMatch",
        () => provider.explainArtistMatch(input),
        () => fallbackArtistMatchExplanation(input.evidence),
      );
    },

    async answerDiscographyQuestion(input) {
      await claim("answerDiscographyQuestion");
      return withFallback(
        "answerDiscographyQuestion",
        () => provider.answerDiscographyQuestion(input),
        () => fallbackDiscographyAnswer(),
      );
    },

    async generatePlaylistTitle(input) {
      await claim("generatePlaylistTitle");
      return withFallback(
        "generatePlaylistTitle",
        () => provider.generatePlaylistTitle(input),
        () => fallbackPlaylistTitle(input.moodText),
      );
    },

    async generatePlaylistDescription(input) {
      await claim("generatePlaylistDescription");
      return withFallback(
        "generatePlaylistDescription",
        () => provider.generatePlaylistDescription(input),
        () => fallbackPlaylistDescription(input.criteria),
      );
    },
  };
}
