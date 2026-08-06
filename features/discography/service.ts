import "server-only";

import { getAiProvider } from "@/lib/ai";
import { AiUsageLimitError, claimAiUsage } from "@/lib/ai/limits";
import { buildDiscography } from "@/lib/discography/retrieval";
import { sanitizeReleases } from "@/lib/discography/sanitize";
import { isCountingQuestion, selectContext } from "@/lib/discography/selection";
import type { Discography } from "@/lib/discography/types";
import {
  INCOMPLETE_FOR_COUNTING_REASON,
  verifyAnswer,
  type VerifiedAnswer,
} from "@/lib/discography/verification";
import { logger } from "@/lib/observability/logger";
import { getMusicBrainzClient } from "@/lib/providers/musicbrainz";
import { MusicBrainzError } from "@/lib/providers/musicbrainz/client";

/**
 * The discography explorer's orchestration: retrieve, sanitize, select, answer,
 * verify.
 *
 * Every step is separable and separately tested. This module's only job is the
 * order, the failure handling, and the decision to refuse before spending an AI
 * request — a counting question against an incomplete discography is answered
 * deterministically and never reaches a model, because no model output could be
 * right.
 *
 * No Spotify module is reachable from here, structurally: the lint rule and the
 * compliance scan both cover `features/discography/**`. Open-in-Spotify on the
 * artist page resolves separately, on demand, exactly as Phase 6 does.
 */

export type DiscographyLoad =
  | { readonly ok: true; readonly value: Discography }
  | {
      readonly ok: false;
      readonly failure: "not-found" | "unavailable";
      readonly message: string;
    };

export async function loadDiscography(
  artistMbid: string,
): Promise<DiscographyLoad> {
  try {
    const lookup = await getMusicBrainzClient().lookupArtist(artistMbid);
    return { ok: true, value: buildDiscography(artistMbid, lookup) };
  } catch (error) {
    if (error instanceof MusicBrainzError && error.kind === "not-found") {
      return {
        ok: false,
        failure: "not-found",
        message: "MusicBrainz has no artist with that identifier.",
      };
    }

    logger.warn({ event: "discography.lookup_failed" });

    return {
      ok: false,
      failure: "unavailable",
      message:
        "MusicBrainz did not respond, so this discography cannot be shown right now.",
    };
  }
}

export type AnswerOutcome =
  | {
      readonly ok: true;
      readonly value: VerifiedAnswer;
      /**
       * Null when no model was consulted. The message table ties `ai_provider`
       * to the assistant role by check constraint, so a deterministic refusal
       * that never reached a provider must not claim one.
       */
      readonly provider: {
        readonly name: string;
        readonly model: string;
      } | null;
    }
  | {
      readonly ok: false;
      readonly failure: "limit" | "unavailable";
      readonly message: string;
    };

export async function answerQuestion(input: {
  readonly discography: Discography;
  readonly question: string;
  readonly userId: string;
}): Promise<AnswerOutcome> {
  const context = selectContext({
    discography: input.discography,
    question: input.question,
  });

  // Refused before an AI request is spent. A count computed from a truncated
  // discography is wrong rather than approximate, so there is no answer a model
  // could give here that would be worth paying for.
  if (isCountingQuestion(input.question) && !context.retrievalComplete) {
    return {
      ok: true,
      provider: null,
      value: {
        status: "insufficient-context",
        reason: INCOMPLETE_FOR_COUNTING_REASON,
        contextTruncated: context.contextTruncated,
        retrievalComplete: context.retrievalComplete,
        totalAvailable: context.totalAvailable,
        consultedCount: context.entries.length,
      },
    };
  }

  const { releases, flaggedIds } = sanitizeReleases(context.entries);

  if (flaggedIds.length > 0) {
    // Logged, never blocking. This is evidence for a future decision about
    // whether detection should ever become a control, and deliberately not one
    // itself: real releases have imperative titles.
    logger.warn({
      event: "discography.instruction_shaped_metadata",
      artistMbid: input.discography.artistMbid,
      flaggedCount: flaggedIds.length,
    });
  }

  const provider = getAiProvider();

  try {
    await claimAiUsage({
      userId: input.userId,
      provider: provider.name,
      operation: "answerDiscographyQuestion",
    });

    const output = await provider.answerDiscographyQuestion({
      question: input.question,
      artistName: input.discography.artistName,
      releases,
    });

    const verified = verifyAnswer({ answer: output, context });

    if (verified.status === "insufficient-context") {
      logger.info({
        event: "discography.answer_not_grounded",
        provider: provider.name,
      });
    }

    return {
      ok: true,
      value: verified,
      provider: { name: provider.name, model: provider.model },
    };
  } catch (error) {
    if (error instanceof AiUsageLimitError) {
      return { ok: false, failure: "limit", message: error.message };
    }

    logger.warn({ event: "discography.answer_failed" });

    return {
      ok: false,
      failure: "unavailable",
      message:
        "The answer could not be generated right now. The release list above is unaffected.",
    };
  }
}
