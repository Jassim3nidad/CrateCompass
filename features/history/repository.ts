import "server-only";

import { decodeCursor, encodeCursor, keysetFilter } from "@/lib/library/cursor";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * History reads.
 *
 * The entries are `discovery_sessions` rows, which nothing wrote before Phase 9
 * — the page read this table and rendered whatever came back, so it was
 * permanently empty and gave no sign of it. That is why the empty state below
 * distinguishes "you have not done anything yet" from "this began recording
 * after you started using CrateCompass".
 *
 * One entry per conversation for discography, not one per question, so an
 * afternoon of questions about one artist is one line rather than six.
 */

export const HISTORY_PAGE_SIZE = 20;

export type HistoryKind = "artist" | "mood" | "discography";

export interface HistoryEntry {
  readonly id: string;
  readonly kind: HistoryKind;
  readonly inputValue: string;
  readonly status: string;
  readonly failureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Candidates recorded for a discovery run. */
  readonly resultCount: number;
  /** Questions asked, for a conversation. */
  readonly questionCount: number;
  /** Present when this session produced a playlist that exists in Spotify. */
  readonly playlistUrl: string | null;
  readonly providers: readonly string[];
}

export interface HistoryPage {
  readonly entries: readonly HistoryEntry[];
  readonly nextCursor: string | null;
  readonly total: number;
}

export async function readHistoryPage(input: {
  readonly userId: string;
  readonly cursor: string | null;
}): Promise<HistoryPage> {
  const supabase = await createClient();
  const cursor = decodeCursor(input.cursor);

  let query = supabase
    .from("discovery_sessions")
    .select(
      "id, input_kind, input_value, status, failure_code, created_at, updated_at",
    )
    .eq("user_id", input.userId);

  if (cursor) {
    query = query.or(keysetFilter({ cursor, sort: "newest" }));
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1);

  if (error) {
    logger.warn({ event: "history.page_read_failed", code: error.code });
    return { entries: [], nextCursor: null, total: 0 };
  }

  const rows = data ?? [];
  const hasMore = rows.length > HISTORY_PAGE_SIZE;
  const visible = hasMore ? rows.slice(0, HISTORY_PAGE_SIZE) : rows;

  const [enriched, total] = await Promise.all([
    enrich({ userId: input.userId, rows: visible }),
    countSessions(input.userId),
  ]);

  const last = visible.at(-1);

  return {
    entries: enriched,
    nextCursor:
      hasMore && last
        ? encodeCursor({ key: last.created_at, id: last.id })
        : null,
    total,
  };
}

async function countSessions(userId: string): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("discovery_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return count ?? 0;
}

type SessionRow = {
  id: string;
  input_kind: string;
  input_value: string;
  status: string;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Fills in the counts and links a history entry needs.
 *
 * Conversations are resolved by `(user_id, canonical_artist_id)` rather than by
 * a foreign key, so no Phase 8 table needed migrating for this.
 */
async function enrich(input: {
  readonly userId: string;
  readonly rows: readonly SessionRow[];
}): Promise<HistoryEntry[]> {
  if (input.rows.length === 0) return [];

  const supabase = await createClient();
  const sessionIds = input.rows.map((row) => row.id);

  const artistIds = input.rows
    .filter((row) => row.input_kind === "discography")
    .map((row) => row.input_value);

  const [results, playlists, conversations] = await Promise.all([
    supabase
      .from("discovery_results")
      .select("session_id, source_provider")
      .eq("user_id", input.userId)
      .in("session_id", sessionIds),
    supabase
      .from("generated_playlists")
      .select("discovery_session_id, spotify_playlist_url")
      .eq("user_id", input.userId)
      .in("discovery_session_id", sessionIds),
    artistIds.length > 0
      ? supabase
          .from("discography_conversations")
          .select("id, canonical_artist_id, artist_name")
          .eq("user_id", input.userId)
          .in("canonical_artist_id", artistIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const conversationRows = conversations.data ?? [];
  const messageCounts = await countMessages({
    userId: input.userId,
    conversationIds: conversationRows.map((row) => row.id),
  });

  return input.rows.map((row) => {
    const rowResults = (results.data ?? []).filter(
      (result) => result.session_id === row.id,
    );

    const conversation = conversationRows.find(
      (candidate) => candidate.canonical_artist_id === row.input_value,
    );

    const playlist = (playlists.data ?? []).find(
      (candidate) => candidate.discovery_session_id === row.id,
    );

    return {
      id: row.id,
      kind: row.input_kind as HistoryKind,
      // A discography session stores the artist identifier; the conversation
      // holds the name a listener would recognise.
      inputValue: conversation?.artist_name ?? row.input_value,
      status: row.status,
      failureCode: row.failure_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resultCount: rowResults.length,
      questionCount: conversation
        ? (messageCounts.get(conversation.id) ?? 0)
        : 0,
      playlistUrl: playlist?.spotify_playlist_url ?? null,
      providers: [
        ...new Set(rowResults.map((result) => result.source_provider)),
      ],
    };
  });
}

/** Questions only: an exchange is one question and one answer. */
async function countMessages(input: {
  readonly userId: string;
  readonly conversationIds: readonly string[];
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  if (input.conversationIds.length === 0) return counts;

  const supabase = await createClient();

  const { data } = await supabase
    .from("discography_messages")
    .select("conversation_id")
    .eq("user_id", input.userId)
    .eq("role", "user")
    .in("conversation_id", [...input.conversationIds]);

  for (const row of data ?? []) {
    counts.set(row.conversation_id, (counts.get(row.conversation_id) ?? 0) + 1);
  }

  return counts;
}

/**
 * Deletes one history entry.
 *
 * Results cascade from the session. A conversation does not — it is resolved by
 * artist rather than by foreign key — so it is deleted explicitly here, which
 * is what closes the retention gap Phase 8 left open.
 *
 * A generated playlist record keeps its row but loses its session link, because
 * the playlist itself still exists in the listener's Spotify account and the
 * interface says so.
 */
export async function deleteHistoryEntry(input: {
  readonly userId: string;
  readonly sessionId: string;
}): Promise<boolean> {
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("discovery_sessions")
    .select("input_kind, input_value")
    .eq("user_id", input.userId)
    .eq("id", input.sessionId)
    .maybeSingle();

  if (session?.input_kind === "discography") {
    await supabase
      .from("discography_conversations")
      .delete()
      .eq("user_id", input.userId)
      .eq("canonical_artist_id", session.input_value);
  }

  const { error } = await supabase
    .from("discovery_sessions")
    .delete()
    .eq("user_id", input.userId)
    .eq("id", input.sessionId);

  if (error) {
    logger.warn({ event: "history.delete_failed", code: error.code });
    return false;
  }

  return true;
}

/** Deletes everything, returning how many entries were removed. */
export async function deleteAllHistory(userId: string): Promise<number> {
  const supabase = await createClient();

  await supabase
    .from("discography_conversations")
    .delete()
    .eq("user_id", userId);

  const { data, error } = await supabase
    .from("discovery_sessions")
    .delete()
    .eq("user_id", userId)
    .select("id");

  if (error) {
    logger.warn({ event: "history.delete_all_failed", code: error.code });
    return 0;
  }

  return data?.length ?? 0;
}
