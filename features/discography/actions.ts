"use server";

import { z } from "zod";

import { MAX_USER_TEXT_LENGTH } from "@/lib/ai/schemas";
import {
  answerQuestion,
  loadDiscography,
} from "@/features/discography/service";
import {
  appendExchange,
  readLatestConversation,
  startConversation,
} from "@/features/discography/repository";
import { toCitation, type AskResult } from "@/features/discography/state";
import {
  completeSession,
  findConversationSession,
  startSession,
  touchSession,
} from "@/lib/library/sessions";
import { getOptionalUser } from "@/lib/supabase/auth";

/**
 * Discography server actions.
 *
 * Same two properties as the discovery and mood actions: inputs are parsed
 * rather than trusted, because a server action is a public endpoint; and every
 * outcome is a named member of a closed union so the interface can render it
 * without guessing.
 *
 * Answering requires an account. It spends metered AI usage that has to be
 * charged to someone, and it writes to a conversation that belongs to a user.
 * Browsing the timeline does not — that is a MusicBrainz read, and the artist
 * page already serves it to anonymous visitors.
 */

const AUTH_REQUIRED = "Sign in to ask questions about a discography.";

const askInputSchema = z
  .object({
    artistMbid: z.uuid(),
    question: z.string().trim().min(1).max(MAX_USER_TEXT_LENGTH),
  })
  .strict();

export async function askQuestionAction(input: unknown): Promise<AskResult> {
  const parsed = askInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "failed",
      message: "That question could not be read. Try rephrasing it.",
    };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { status: "auth-required", message: AUTH_REQUIRED };
  }

  const discography = await loadDiscography(parsed.data.artistMbid);

  if (!discography.ok) {
    return { status: "failed", message: discography.message };
  }

  const outcome = await answerQuestion({
    discography: discography.value,
    question: parsed.data.question,
    userId: user.id,
  });

  if (!outcome.ok) {
    return outcome.failure === "limit"
      ? { status: "limit-reached", message: outcome.message }
      : { status: "failed", message: outcome.message };
  }

  const verified = outcome.value;

  const provenance = {
    retrievalComplete: verified.retrievalComplete,
    contextTruncated: verified.contextTruncated,
    totalAvailable: verified.totalAvailable,
    consultedCount: verified.consultedCount,
  };

  // Persisted only when a model actually answered. A deterministic refusal is
  // not an assistant message — the table's check constraint ties `ai_provider`
  // to that role, and claiming a provider that was never consulted would make
  // "which model said this" unanswerable for the rows that do have one.
  if (verified.status === "answered" && outcome.provider) {
    await persistExchange({
      userId: user.id,
      canonicalArtistId: parsed.data.artistMbid,
      artistName: discography.value.artistName,
      question: parsed.data.question,
      answer: verified.answer,
      provider: outcome.provider,
    });

    await recordConversationSession({
      userId: user.id,
      canonicalArtistId: parsed.data.artistMbid,
    });

    return {
      status: "answered",
      answer: verified.answer,
      citations: verified.citations.map(toCitation),
      provenance,
    };
  }

  return {
    status: "insufficient-context",
    reason:
      verified.status === "insufficient-context"
        ? verified.reason
        : "That answer could not be grounded in the retrieved records.",
    provenance,
  };
}

/**
 * One history entry per conversation, not per question.
 *
 * Per-question rows would give six near-identical entries for one afternoon's
 * questions about an artist, which reads as noise rather than history. The
 * session is keyed on the artist identifier so a returning listener continues
 * the same entry, and `updated_at` is what orders history by recency.
 */
async function recordConversationSession(input: {
  readonly userId: string;
  readonly canonicalArtistId: string;
}): Promise<void> {
  const existing = await findConversationSession(input);

  if (existing) {
    await touchSession({ userId: input.userId, sessionId: existing });
    return;
  }

  const sessionId = await startSession({
    userId: input.userId,
    kind: "discography",
    // The artist identifier, not the question: the entry represents the
    // conversation, and its question count comes from the messages.
    inputValue: input.canonicalArtistId,
  });

  await completeSession({ userId: input.userId, sessionId });
}

/**
 * Writes the exchange, reusing this artist's most recent conversation.
 *
 * A persistence failure is deliberately not surfaced: the listener has their
 * answer, and telling them the history did not save would be alarming out of
 * proportion to the loss. It is logged in the repository.
 */
async function persistExchange(input: {
  readonly userId: string;
  readonly canonicalArtistId: string;
  readonly artistName: string;
  readonly question: string;
  readonly answer: string;
  readonly provider: { readonly name: string; readonly model: string };
}): Promise<void> {
  const existing = await readLatestConversation({
    userId: input.userId,
    canonicalArtistId: input.canonicalArtistId,
  });

  const conversationId =
    existing?.id ??
    (await startConversation({
      userId: input.userId,
      canonicalArtistId: input.canonicalArtistId,
      artistName: input.artistName,
      // The first question becomes the title, which is what a listener would
      // recognise the conversation by in Phase 9's history.
      title: input.question.slice(0, 255),
    }));

  if (!conversationId) return;

  await appendExchange({
    userId: input.userId,
    conversationId,
    question: input.question,
    answer: input.answer,
    aiProvider: input.provider.name,
    aiModel: input.provider.model,
  });
}
