import "server-only";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per-user AI usage limits, sized for a five-user Development Mode pilot.
 *
 * The counting happens in Postgres (see the Phase 5 migration) because the app
 * is serverless — a process-local counter resets on every cold start and is not
 * shared between instances, so a per-day cap would not actually cap anything.
 */

export const AI_LIMITS = {
  perUserPerDay: 20,
  perUserPerMinute: 4,
  maxPromptCharacters: 2000,
  requestTimeoutMs: 30_000,
} as const;

export class AiUsageLimitError extends Error {
  readonly scope: "daily" | "burst";

  constructor(scope: "daily" | "burst") {
    super(
      scope === "daily"
        ? "You have reached today's limit for AI-assisted requests."
        : "That was a little quick — wait a moment before trying again.",
    );
    this.name = "AiUsageLimitError";
    this.scope = scope;
  }
}

/**
 * Claims one usage slot, or throws.
 *
 * The decision and the record happen in a single statement server-side, so two
 * concurrent requests cannot both observe a count below the limit and both
 * proceed.
 *
 * **Fails closed.** If the limit store is unreachable the request is refused
 * rather than allowed through — the opposite of the cache in
 * `lib/providers/cache.ts`, which degrades to a live call. The difference is
 * what an error costs: an unmetered cache miss costs a provider round trip, an
 * unmetered AI call costs money and has no ceiling.
 */
export async function claimAiUsage(input: {
  readonly userId: string;
  readonly provider: "anthropic" | "openai" | "openrouter" | "gemini";
  readonly operation: string;
}): Promise<void> {
  const { data, error } = await createAdminClient().rpc("claim_ai_usage", {
    p_user_id: input.userId,
    p_provider: input.provider,
    p_operation: input.operation,
    p_daily_limit: AI_LIMITS.perUserPerDay,
    p_per_minute_limit: AI_LIMITS.perUserPerMinute,
  });

  if (error) {
    logger.error({
      event: "ai.usage_claim_failed",
      operation: input.operation,
      code: error.code,
    });
    throw new AiUsageLimitError("burst");
  }

  if (data !== true) {
    logger.info({
      event: "ai.usage_limit_reached",
      operation: input.operation,
    });
    // The RPC returns a single boolean, so the two windows are not
    // distinguishable from here. Reporting the daily scope is the safer of the
    // two: it does not invite an immediate retry that would also be refused.
    throw new AiUsageLimitError("daily");
  }
}
