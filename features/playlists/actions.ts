"use server";

import { z } from "zod";

import { createPlaylistFromDraft } from "@/features/playlists/creation";
import type { CreationResult } from "@/features/mood/state";
import { getOptionalUser } from "@/lib/supabase/auth";

/**
 * Playlist creation action.
 *
 * Separate from the mood actions so the module that touches Spotify is not the
 * module that touches AI. `features/playlists/**` imports no AI module and
 * `features/mood/**` imports no Spotify module; the two capabilities never meet
 * in one file.
 *
 * The idempotency key comes from the client because it must survive a retry of
 * the *same* submission — a server-generated key would be new on every attempt,
 * which is exactly the duplicate this exists to prevent.
 */

const createInputSchema = z
  .object({
    playlistId: z.uuid(),
    idempotencyKey: z.string().trim().min(8).max(255),
    avoidExplicit: z.boolean(),
  })
  .strict();

export async function createPlaylistAction(
  input: unknown,
): Promise<CreationResult> {
  const parsed = createInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "failed",
      message: "That confirmation could not be read. Reload the draft.",
    };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return {
      status: "auth-required",
      message: "Sign in to create this playlist.",
    };
  }

  return createPlaylistFromDraft({
    userId: user.id,
    playlistId: parsed.data.playlistId,
    idempotencyKey: parsed.data.idempotencyKey,
    avoidExplicit: parsed.data.avoidExplicit,
  });
}
