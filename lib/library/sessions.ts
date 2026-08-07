import "server-only";

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Recording what happened, so history has something truthful to show.
 *
 * Until Phase 9 nothing wrote `discovery_sessions`. `app/history/page.tsx` read
 * it and rendered whatever came back, so the page was permanently empty and
 * gave no sign of it — an empty history looks exactly like a new account.
 *
 * Two rules govern everything here.
 *
 * **A session write must never fail a listener's request.** History is a record
 * of work, not a precondition for it. Every function returns rather than
 * throws, and a failure is logged and swallowed. Someone whose playlist was
 * created must not see an error because the audit row did not land.
 *
 * **Nothing is backfilled.** Recording starts when the feature ships and runs
 * forward. Existing accounts have playlists, favourites and conversations but
 * no sessions, and reconstructing entries from them would put plausible
 * timestamps on events that were never recorded. An honest gap beats a
 * fabricated trail, and the empty state says so.
 */

/**
 * When history started recording.
 *
 * Load-bearing for the empty state, not decoration. An account created before
 * this date and an account created yesterday both show nothing on a fresh
 * history page, and "no history yet" would be misleading for the first — it
 * implies nothing happened, when the truth is that nothing was recorded.
 *
 * Nothing is backfilled to close that gap. Reconstructing entries from
 * playlists, favourites and conversations would put plausible timestamps on
 * events that were never observed, and a fabricated audit trail is worse than
 * an honest one with a start date.
 */
export const HISTORY_TRACKING_STARTED_AT = "2026-08-07T00:00:00.000Z";

/** True when this account existed before anything was being recorded. */
export function predatesHistoryTracking(
  accountCreatedAt: string | undefined,
): boolean {
  if (!accountCreatedAt) return false;

  const created = Date.parse(accountCreatedAt);

  return (
    Number.isFinite(created) &&
    created < Date.parse(HISTORY_TRACKING_STARTED_AT)
  );
}

export type SessionKind = "artist" | "mood" | "discography";

/** Opens a session. Returns null on any failure, having logged it. */
export async function startSession(input: {
  readonly userId: string;
  readonly kind: SessionKind;
  readonly inputValue: string;
}): Promise<string | null> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("discovery_sessions")
      .insert({
        user_id: input.userId,
        input_kind: input.kind,
        input_value: input.inputValue.slice(0, 500),
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !data) {
      logger.warn({ event: "history.session_start_failed", code: error?.code });
      return null;
    }

    return data.id;
  } catch {
    logger.warn({ event: "history.session_start_threw" });
    return null;
  }
}

/**
 * Marks a session complete.
 *
 * `completed_at` is set here and only here: the table's check constraint ties
 * it to the status, so the two must move together.
 */
export async function completeSession(input: {
  readonly userId: string;
  readonly sessionId: string | null;
}): Promise<void> {
  if (!input.sessionId) return;

  try {
    const supabase = await createClient();

    await supabase
      .from("discovery_sessions")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
      })
      .eq("user_id", input.userId)
      .eq("id", input.sessionId)
      .eq("status", "pending");
  } catch {
    logger.warn({ event: "history.session_complete_threw" });
  }
}

export async function failSession(input: {
  readonly userId: string;
  readonly sessionId: string | null;
  readonly failureCode: string;
}): Promise<void> {
  if (!input.sessionId) return;

  try {
    const supabase = await createClient();

    await supabase
      .from("discovery_sessions")
      .update({
        status: "failed",
        failure_code: input.failureCode.slice(0, 100),
      })
      .eq("user_id", input.userId)
      .eq("id", input.sessionId);
  } catch {
    logger.warn({ event: "history.session_fail_threw" });
  }
}

/**
 * Touches a session that has grown.
 *
 * Used by discography, where one session covers a whole conversation rather
 * than one question, so `updated_at` is what orders history by recency.
 */
export async function touchSession(input: {
  readonly userId: string;
  readonly sessionId: string;
}): Promise<void> {
  try {
    const supabase = await createClient();

    await supabase
      .from("discovery_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("user_id", input.userId)
      .eq("id", input.sessionId);
  } catch {
    logger.warn({ event: "history.session_touch_threw" });
  }
}

/** The open session for an artist's conversation, if one exists. */
export async function findConversationSession(input: {
  readonly userId: string;
  readonly canonicalArtistId: string;
}): Promise<string | null> {
  try {
    const supabase = await createClient();

    const { data } = await supabase
      .from("discovery_sessions")
      .select("id")
      .eq("user_id", input.userId)
      .eq("input_kind", "discography")
      .eq("input_value", input.canonicalArtistId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.id ?? null;
  } catch {
    return null;
  }
}

export interface SessionResultInput {
  readonly rank: number;
  readonly artistName: string;
  readonly canonicalArtistId: string | null;
  readonly rationale: string;
  readonly sourceProvider: string;
  readonly sourceReference: string | null;
}

/**
 * Records what a discovery run produced.
 *
 * This is the history copy of an explanation. The library keeps its own
 * snapshot on the favourite, because this row cascades away with its session
 * and clearing history must not strip a saved discovery of its reasoning.
 */
export async function recordResults(input: {
  readonly userId: string;
  readonly sessionId: string | null;
  readonly results: readonly SessionResultInput[];
}): Promise<void> {
  const sessionId = input.sessionId;

  if (!sessionId || input.results.length === 0) return;

  try {
    const supabase = await createClient();

    const { error } = await supabase.from("discovery_results").insert(
      input.results.map((result) => ({
        session_id: sessionId,
        user_id: input.userId,
        rank: result.rank,
        artist_name: result.artistName.slice(0, 255),
        canonical_artist_id: result.canonicalArtistId,
        // The column requires at least one character, and an empty rationale
        // would fail the whole insert and lose the other rows with it.
        rationale: (result.rationale || "No explanation recorded.").slice(
          0,
          2000,
        ),
        source_provider: result.sourceProvider,
        source_reference: result.sourceReference,
      })),
    );

    if (error) {
      logger.warn({ event: "history.results_write_failed", code: error.code });
    }
  } catch {
    logger.warn({ event: "history.results_write_threw" });
  }
}
