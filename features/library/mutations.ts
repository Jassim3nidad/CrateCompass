import "server-only";

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Library writes.
 *
 * Deletion here is a real `delete`. Nothing in this module hides a row from a
 * query while leaving it in the table, and the pgTAP suite asserts that after a
 * delete the row is absent from the table rather than filtered out of a view —
 * a standing guard against a soft delete creeping back in later.
 */

export interface RestorableFavorite {
  readonly artistName: string;
  readonly recordingName: string | null;
  readonly canonicalArtistId: string | null;
  readonly sourceType: "artist" | "mood" | "discography" | "manual";
  readonly sourceReference: string | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly explanation: unknown;
  readonly explanationVersion: number | null;
  readonly explanationSource: "ai" | "template" | null;
  readonly explanationProvider: string | null;
  readonly explanationModel: string | null;
}

/**
 * Removes one favourite and hands back what it held.
 *
 * The returned value is what makes undo possible without keeping the row: the
 * browser holds it for the length of the undo window and nothing survives
 * server-side in the meantime.
 */
export async function removeFavorite(input: {
  readonly userId: string;
  readonly id: string;
}): Promise<RestorableFavorite | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorite_discoveries")
    .delete()
    .eq("user_id", input.userId)
    .eq("id", input.id)
    .select(
      "artist_name, recording_name, canonical_artist_id, source_type, source_reference, note, tags, explanation, explanation_version, explanation_source, explanation_provider, explanation_model",
    )
    .maybeSingle();

  if (error || !data) {
    if (error) {
      logger.warn({ event: "library.remove_failed", code: error.code });
    }
    return null;
  }

  return {
    artistName: data.artist_name,
    recordingName: data.recording_name,
    canonicalArtistId: data.canonical_artist_id,
    sourceType: data.source_type as RestorableFavorite["sourceType"],
    sourceReference: data.source_reference,
    note: data.note,
    tags: data.tags ?? [],
    explanation: data.explanation,
    explanationVersion: data.explanation_version,
    explanationSource:
      data.explanation_source as RestorableFavorite["explanationSource"],
    explanationProvider: data.explanation_provider,
    explanationModel: data.explanation_model,
  };
}

/**
 * Re-inserts a removed favourite.
 *
 * Deliberately an insert, not an undelete. The row gets a new id and a new
 * `created_at`, which is the honest consequence of having actually deleted it,
 * and the interface says the item was added back rather than restored.
 */
export async function restoreFavorite(input: {
  readonly userId: string;
  readonly favorite: RestorableFavorite;
}): Promise<boolean> {
  const supabase = await createClient();
  const { favorite } = input;

  const { error } = await supabase.from("favorite_discoveries").insert({
    user_id: input.userId,
    artist_name: favorite.artistName,
    recording_name: favorite.recordingName,
    canonical_artist_id: favorite.canonicalArtistId,
    source_type: favorite.sourceType,
    source_reference: favorite.sourceReference,
    note: favorite.note,
    tags: [...favorite.tags],
    explanation: favorite.explanation as never,
    explanation_version: favorite.explanationVersion,
    explanation_source: favorite.explanationSource,
    explanation_provider: favorite.explanationProvider,
    explanation_model: favorite.explanationModel,
  });

  if (error) {
    logger.warn({ event: "library.restore_failed", code: error.code });
    return false;
  }

  return true;
}

/** Returns how many rows were actually removed, which is what the UI reports. */
export async function bulkRemoveFavorites(input: {
  readonly userId: string;
  readonly ids: readonly string[];
}): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorite_discoveries")
    .delete()
    .eq("user_id", input.userId)
    .in("id", [...input.ids])
    .select("id");

  if (error) {
    logger.warn({ event: "library.bulk_remove_failed", code: error.code });
    return 0;
  }

  return data?.length ?? 0;
}

export async function updateNote(input: {
  readonly userId: string;
  readonly id: string;
  readonly note: string | null;
}): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("favorite_discoveries")
    .update({ note: input.note })
    .eq("user_id", input.userId)
    .eq("id", input.id);

  return !error;
}

export async function updateTags(input: {
  readonly userId: string;
  readonly id: string;
  readonly tags: readonly string[];
}): Promise<boolean> {
  const supabase = await createClient();

  // Sent raw. The database trigger trims, lowercases, deduplicates and drops
  // empties, so normalisation happens in one place rather than at each caller.
  const { error } = await supabase
    .from("favorite_discoveries")
    .update({ tags: [...input.tags] })
    .eq("user_id", input.userId)
    .eq("id", input.id);

  return !error;
}
