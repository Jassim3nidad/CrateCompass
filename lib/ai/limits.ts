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

/**
 * Operations that tolerate a wider burst than the default four a minute.
 *
 * The two windows do different jobs. The per-minute window stops runaway loops
 * and double-submits; the daily cap is what bounds spend. Conversation is the
 * case the burst window was never sized for — four questions inside a minute is
 * ordinary behaviour, not abuse — so the tolerance is raised there and the
 * daily ceiling is left alone. Maximum spend per user does not change.
 *
 * One consequence worth knowing: `claim_ai_usage` counts every event in the
 * window, not just this operation's. Raising the figure here means "allow this
 * operation to proceed with up to N recent AI calls of any kind behind it", so
 * ten rapid questions will then block a mood parse, which still allows four.
 * The burst window is shared; the operation states what it will accept.
 */
const PER_MINUTE_BY_OPERATION: Readonly<Record<string, number>> = {
  answerDiscographyQuestion: 10,
};

export function perMinuteLimitFor(operation: string): number {
  // `Object.hasOwn` rather than a bare lookup: the operation name reaches here
  // from a call site, and "constructor" would otherwise resolve to a function
  // off the prototype chain and be handed to Postgres as a limit.
  return Object.hasOwn(PER_MINUTE_BY_OPERATION, operation)
    ? (PER_MINUTE_BY_OPERATION[operation] ?? AI_LIMITS.perUserPerMinute)
    : AI_LIMITS.perUserPerMinute;
}

/**
 * How many AI requests the listener has left today.
 *
 * Read-only, and deliberately not part of claiming: a display that consumed a
 * slot to render itself would penalise looking at the limiter. Returns null
 * when the count cannot be read, so the interface omits the figure rather than
 * inventing one — the limiter itself still fails closed regardless.
 */
export async function readRemainingDailyUsage(
  userId: string,
): Promise<number | null> {
  const { data, error } = await createAdminClient().rpc(
    "read_ai_usage_remaining",
    { p_user_id: userId, p_daily_limit: AI_LIMITS.perUserPerDay },
  );

  if (error || typeof data !== "number") {
    logger.warn({ event: "ai.usage_remaining_read_failed", code: error?.code });
    return null;
  }

  return data;
}

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
    p_per_minute_limit: perMinuteLimitFor(input.operation),
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
