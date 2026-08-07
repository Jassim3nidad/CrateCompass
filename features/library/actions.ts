"use server";

import { z } from "zod";

import { getOptionalUser } from "@/lib/supabase/auth";
import {
  bulkRemoveFavorites,
  removeFavorite,
  restoreFavorite,
  updateNote,
  updateTags,
  type RestorableFavorite,
} from "@/features/library/mutations";

/**
 * Library mutations.
 *
 * Deletion is genuine. There is no `deleted_at` column and no holding table:
 * the compliance requirement is that deleted records not remain accessible
 * through normal APIs, and a row that ordinary queries filter out is exactly
 * "still there, just hidden" — it would satisfy the sentence and fail the
 * residual-data query the threat model commits to under T23.
 *
 * Undo therefore works by handing the removed row back to the browser and
 * re-inserting it if the listener asks within the window. The restored row is a
 * new row: new id, new `created_at`. The interface says so rather than
 * pretending nothing happened, because a library that quietly rewrites its own
 * timestamps is lying about when things were kept.
 */

const AUTH_REQUIRED = "Sign in to manage your library.";
const INVALID = "That request could not be understood.";

const idSchema = z.uuid();

export type RemoveResult =
  | {
      readonly status: "removed";
      /** Held in browser state so undo can re-insert it. */
      readonly restorable: RestorableFavorite;
      readonly message: string;
    }
  | { readonly status: "auth-required"; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

export async function removeFavoriteAction(
  input: unknown,
): Promise<RemoveResult> {
  const parsed = z.object({ id: idSchema }).safeParse(input);

  if (!parsed.success) {
    return { status: "failed", message: INVALID };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { status: "auth-required", message: AUTH_REQUIRED };
  }

  const removed = await removeFavorite({
    userId: user.id,
    id: parsed.data.id,
  });

  if (!removed) {
    return {
      status: "failed",
      message: "That could not be removed. Try again shortly.",
    };
  }

  return {
    status: "removed",
    restorable: removed,
    message: "Removed. Undo is available until you leave this page.",
  };
}

const restorableSchema = z.object({
  artistName: z.string().trim().min(1).max(255),
  recordingName: z.string().trim().max(500).nullable(),
  canonicalArtistId: z.string().trim().max(255).nullable(),
  sourceType: z.enum(["artist", "mood", "discography", "manual"]),
  sourceReference: z.string().trim().max(1000).nullable(),
  note: z.string().trim().max(2000).nullable(),
  tags: z.array(z.string().trim().max(40)).max(20),
  explanation: z.unknown().nullable(),
  explanationVersion: z.number().int().positive().nullable(),
  explanationSource: z.enum(["ai", "template"]).nullable(),
  explanationProvider: z.string().trim().max(40).nullable(),
  explanationModel: z.string().trim().max(255).nullable(),
});

export async function restoreFavoriteAction(
  input: unknown,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const parsed = restorableSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: INVALID };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { ok: false, message: AUTH_REQUIRED };
  }

  const restored = await restoreFavorite({
    userId: user.id,
    favorite: parsed.data as RestorableFavorite,
  });

  return restored
    ? {
        ok: true,
        // Not "restored": it is a new row with today's date, and saying
        // otherwise would misrepresent when it was kept.
        message: "Added back to your library, dated today.",
      }
    : { ok: false, message: "That could not be added back." };
}

export async function bulkRemoveAction(
  input: unknown,
): Promise<{ readonly removed: number; readonly message: string }> {
  const parsed = z
    .object({ ids: z.array(idSchema).min(1).max(200) })
    .safeParse(input);

  if (!parsed.success) {
    return { removed: 0, message: INVALID };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { removed: 0, message: AUTH_REQUIRED };
  }

  const removed = await bulkRemoveFavorites({
    userId: user.id,
    ids: parsed.data.ids,
  });

  return {
    removed,
    // No undo is offered here, and the message does not imply one. An undo that
    // usually fails is worse than none.
    message:
      removed === 1
        ? "1 item removed. This cannot be undone."
        : `${removed} items removed. This cannot be undone.`,
  };
}

export async function updateNoteAction(
  input: unknown,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const parsed = z
    .object({ id: idSchema, note: z.string().trim().max(2000) })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: INVALID };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { ok: false, message: AUTH_REQUIRED };
  }

  const ok = await updateNote({
    userId: user.id,
    id: parsed.data.id,
    note: parsed.data.note.length > 0 ? parsed.data.note : null,
  });

  return ok
    ? { ok: true, message: "Note saved." }
    : { ok: false, message: "That note could not be saved." };
}

export async function updateTagsAction(
  input: unknown,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const parsed = z
    .object({
      id: idSchema,
      // The database trigger normalises and deduplicates; these bounds only
      // stop an oversized payload reaching it.
      tags: z.array(z.string().trim().max(40)).max(20),
    })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: INVALID };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { ok: false, message: AUTH_REQUIRED };
  }

  const ok = await updateTags({
    userId: user.id,
    id: parsed.data.id,
    tags: parsed.data.tags,
  });

  return ok
    ? { ok: true, message: "Tags saved." }
    : { ok: false, message: "Those tags could not be saved." };
}
