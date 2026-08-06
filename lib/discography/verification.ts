import type { DiscographyAnswer } from "@/lib/ai/schemas";
import type { SelectedContext } from "@/lib/discography/selection";
import type { TimelineEntry } from "@/lib/discography/types";

/**
 * Checking an answer against the records it was supposed to come from.
 *
 * The same shape as the Phase 6 explanation check, and for the same reason: the
 * guarantee is enforced after the model answers rather than requested politely
 * in a prompt. A citation naming a release that was never supplied means the
 * model is drawing on something we did not give it, so the whole answer is
 * discarded rather than partially trusted.
 *
 * What this catches: a fabricated release, a hallucinated identifier, and an
 * answer manipulated into citing something outside its context.
 *
 * What this cannot catch, stated plainly because it motivates the input
 * neutralisation in `sanitize.ts`: an injected string steering the model into
 * refusing a legitimate question, or into describing a genuinely-supplied
 * release wrongly while citing it correctly. Post-answer checking sees the
 * citation, not the sentence.
 */

export type VerifiedAnswer =
  | {
      readonly status: "answered";
      readonly answer: string;
      readonly citations: readonly TimelineEntry[];
      readonly contextTruncated: boolean;
      readonly retrievalComplete: boolean;
      readonly totalAvailable: number;
      readonly consultedCount: number;
    }
  | {
      readonly status: "insufficient-context";
      readonly reason: string;
      readonly contextTruncated: boolean;
      readonly retrievalComplete: boolean;
      readonly totalAvailable: number;
      readonly consultedCount: number;
    };

/** The deterministic response used whenever the model's answer is not usable. */
export const INSUFFICIENT_CONTEXT_REASON =
  "The retrieved MusicBrainz records do not contain enough to answer that.";

/** A count from a truncated discography is wrong, not approximate. */
export const INCOMPLETE_FOR_COUNTING_REASON =
  "The full discography could not be retrieved, so a count would be wrong rather than approximate.";

export function verifyAnswer(input: {
  readonly answer: DiscographyAnswer;
  readonly context: SelectedContext;
}): VerifiedAnswer {
  const { answer, context } = input;

  const shared = {
    contextTruncated: context.contextTruncated,
    retrievalComplete: context.retrievalComplete,
    totalAvailable: context.totalAvailable,
    consultedCount: context.entries.length,
  } as const;

  if (!answer.sufficientContext) {
    return {
      status: "insufficient-context",
      // The model's own reason is preferred when it gave one: it is more
      // specific than the generic sentence and is not a factual claim.
      reason: answer.unansweredReason?.trim() || INSUFFICIENT_CONTEXT_REASON,
      ...shared,
    };
  }

  if (answer.answer.trim().length === 0) {
    return {
      status: "insufficient-context",
      reason: INSUFFICIENT_CONTEXT_REASON,
      ...shared,
    };
  }

  const supplied = new Map(
    context.entries.map((entry) => [entry.mbid.toLowerCase(), entry]),
  );

  const citations: TimelineEntry[] = [];

  for (const id of answer.citedReleaseIds) {
    const match = supplied.get(id.trim().toLowerCase());

    // One unsupplied citation discards the whole answer. Dropping just the bad
    // citation would leave prose that may have been built on it, which is a
    // quieter version of the same failure.
    if (!match) {
      return {
        status: "insufficient-context",
        reason: INSUFFICIENT_CONTEXT_REASON,
        ...shared,
      };
    }

    if (!citations.includes(match)) {
      citations.push(match);
    }
  }

  return {
    status: "answered",
    answer: answer.answer.trim(),
    citations,
    ...shared,
  };
}
