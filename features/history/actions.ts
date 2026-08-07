"use server";

import { z } from "zod";

import {
  deleteAllHistory,
  deleteHistoryEntry,
} from "@/features/history/repository";
import { getOptionalUser } from "@/lib/supabase/auth";

/**
 * History mutations.
 *
 * Deletion is genuine here too, and for a history entry there is no undo at
 * all: an audit trail a listener chose to erase should not be recoverable by
 * the product that was told to erase it.
 */

const AUTH_REQUIRED = "Sign in to manage your history.";

export async function deleteHistoryEntryAction(
  input: unknown,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That entry could not be identified." };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { ok: false, message: AUTH_REQUIRED };
  }

  const ok = await deleteHistoryEntry({
    userId: user.id,
    sessionId: parsed.data.id,
  });

  return ok
    ? { ok: true, message: "Entry deleted. This cannot be undone." }
    : { ok: false, message: "That entry could not be deleted." };
}

export async function deleteAllHistoryAction(): Promise<{
  readonly removed: number;
  readonly message: string;
}> {
  const { user } = await getOptionalUser();

  if (!user) {
    return { removed: 0, message: AUTH_REQUIRED };
  }

  const removed = await deleteAllHistory(user.id);

  return {
    removed,
    message:
      removed === 1
        ? "1 entry deleted. Playlists already in Spotify are unaffected."
        : `${removed} entries deleted. Playlists already in Spotify are unaffected.`,
  };
}
