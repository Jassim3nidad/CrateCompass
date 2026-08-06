import "server-only";

import { createHash } from "node:crypto";

import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Playlist persistence and the idempotency claim.
 *
 * Two clients, deliberately:
 *
 * - The **request-scoped** client for everything the listener owns, so Row
 *   Level Security is the authority.
 * - The **admin** client for the three idempotency RPCs only. Those live over
 *   `private.idempotency_records`, which PostgREST does not expose and
 *   `service_role` has no schema USAGE on — reviewed `security definer`
 *   functions are the only path, matching the Phase 3 and Phase 5 pattern.
 */

export interface DraftTrackInput {
  readonly position: number;
  readonly recordingMbid: string;
  readonly artistMbid: string;
  readonly title: string;
  readonly artistName: string;
  readonly releaseTitle: string | null;
}

export interface StoredDraft {
  readonly playlistId: string;
  readonly title: string;
  readonly description: string;
  /** The listener's own words, so a resumed draft can show what was asked. */
  readonly moodText: string;
  readonly isPublic: boolean;
  readonly status: string;
  readonly tracks: readonly (DraftTrackInput & {
    readonly id: string;
    readonly status: string;
    readonly spotifyUri: string | null;
  })[];
}

/** Stable across retries of the same request, which is what makes it a key. */
export function digestRequest(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}

export async function saveDraft(input: {
  readonly userId: string;
  readonly moodText: string;
  readonly title: string;
  readonly description: string;
  readonly isPublic: boolean;
  readonly tracks: readonly DraftTrackInput[];
}): Promise<string | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("generated_playlists")
    .insert({
      user_id: input.userId,
      name: input.title.slice(0, 255),
      description: input.description.slice(0, 1000),
      mood_text: input.moodText.slice(0, 2000),
      is_public: input.isPublic,
      status: "draft",
      track_total: input.tracks.length,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error({ event: "playlist.draft_insert_failed", code: error?.code });
    return null;
  }

  if (input.tracks.length === 0) {
    return data.id;
  }

  const { error: tracksError } = await supabase
    .from("generated_playlist_tracks")
    .insert(
      input.tracks.map((track) => ({
        playlist_id: data.id,
        user_id: input.userId,
        position: track.position,
        recording_mbid: track.recordingMbid,
        artist_mbid: track.artistMbid,
        track_title: track.title.slice(0, 500),
        artist_name: track.artistName.slice(0, 255),
        release_title: track.releaseTitle?.slice(0, 500) ?? null,
        status: "pending",
      })),
    );

  if (tracksError) {
    logger.error({
      event: "playlist.draft_tracks_insert_failed",
      code: tracksError.code,
    });
    return null;
  }

  return data.id;
}

export async function readDraft(input: {
  readonly userId: string;
  readonly playlistId: string;
}): Promise<StoredDraft | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("generated_playlists")
    .select("id, name, description, mood_text, is_public, status")
    .eq("user_id", input.userId)
    .eq("id", input.playlistId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const { data: tracks } = await supabase
    .from("generated_playlist_tracks")
    .select(
      "id, position, recording_mbid, artist_mbid, track_title, artist_name, release_title, status, spotify_uri",
    )
    .eq("user_id", input.userId)
    .eq("playlist_id", input.playlistId)
    .order("position");

  return {
    playlistId: data.id,
    title: data.name,
    description: data.description ?? "",
    moodText: data.mood_text ?? "",
    isPublic: data.is_public,
    status: data.status,
    tracks: (tracks ?? []).map((track) => ({
      id: track.id,
      position: track.position,
      recordingMbid: track.recording_mbid,
      artistMbid: track.artist_mbid,
      title: track.track_title,
      artistName: track.artist_name,
      releaseTitle: track.release_title,
      status: track.status,
      spotifyUri: track.spotify_uri,
    })),
  };
}

export async function removeDraftTrack(input: {
  readonly userId: string;
  readonly playlistId: string;
  readonly trackId: string;
}): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("generated_playlist_tracks")
    .delete()
    .eq("user_id", input.userId)
    .eq("playlist_id", input.playlistId)
    .eq("id", input.trackId);

  if (error) {
    logger.error({ event: "playlist.track_remove_failed", code: error.code });
    return false;
  }

  const { count } = await supabase
    .from("generated_playlist_tracks")
    .select("id", { count: "exact", head: false })
    .eq("user_id", input.userId)
    .eq("playlist_id", input.playlistId);

  await supabase
    .from("generated_playlists")
    .update({ track_total: count ?? 0 })
    .eq("user_id", input.userId)
    .eq("id", input.playlistId);

  return true;
}

export async function markCreating(input: {
  readonly userId: string;
  readonly playlistId: string;
  readonly idempotencyKey: string;
}): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("generated_playlists")
    .update({ status: "creating", idempotency_key: input.idempotencyKey })
    .eq("user_id", input.userId)
    .eq("id", input.playlistId)
    .eq("status", "draft");

  return !error;
}

export async function recordCreationOutcome(input: {
  readonly userId: string;
  readonly playlistId: string;
  readonly spotifyPlaylistId: string;
  readonly spotifyUrl: string;
  readonly tracksAdded: number;
  readonly status: "created" | "partial" | "failed";
  readonly failureCode?: string | null;
}): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("generated_playlists")
    .update({
      status: input.status,
      spotify_playlist_id: input.spotifyPlaylistId,
      spotify_playlist_url: input.spotifyUrl,
      tracks_added: input.tracksAdded,
      failure_code: input.failureCode ?? null,
    })
    .eq("user_id", input.userId)
    .eq("id", input.playlistId);

  if (error) {
    logger.error({ event: "playlist.outcome_write_failed", code: error.code });
  }
}

export async function markDraftFailed(input: {
  readonly userId: string;
  readonly playlistId: string;
  readonly failureCode: string;
}): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("generated_playlists")
    .update({ status: "failed", failure_code: input.failureCode })
    .eq("user_id", input.userId)
    .eq("id", input.playlistId);
}

export async function updateTrackResolution(input: {
  readonly userId: string;
  readonly trackId: string;
  readonly spotifyUri: string | null;
  readonly status: "added" | "unresolved" | "failed";
}): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("generated_playlist_tracks")
    .update({ spotify_uri: input.spotifyUri, status: input.status })
    .eq("user_id", input.userId)
    .eq("id", input.trackId);
}

export type IdempotencyClaim =
  | { readonly outcome: "claimed" }
  | { readonly outcome: "replay"; readonly response: unknown }
  | { readonly outcome: "conflict" }
  | { readonly outcome: "in-progress" };

export async function claimIdempotencyKey(input: {
  readonly userId: string;
  readonly operation: string;
  readonly key: string;
  readonly requestDigest: Buffer;
}): Promise<IdempotencyClaim> {
  const { data, error } = await createAdminClient().rpc(
    "claim_idempotency_key",
    {
      p_user_id: input.userId,
      p_operation: input.operation,
      p_idempotency_key: input.key,
      // PostgREST represents bytea as a hex string prefixed with \x.
      p_request_digest: `\\x${input.requestDigest.toString("hex")}`,
      p_ttl_seconds: 86_400,
    },
  );

  if (error) {
    logger.error({
      event: "playlist.idempotency_claim_failed",
      code: error.code,
    });
    // Fails closed. Allowing an unmetered retry risks a duplicate playlist in
    // someone's Spotify account, which is the one outcome this must prevent.
    return { outcome: "conflict" };
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row) {
    return { outcome: "conflict" };
  }

  if (row.claimed) {
    return { outcome: "claimed" };
  }

  if (row.conflict) {
    return { outcome: "conflict" };
  }

  return row.response_body
    ? { outcome: "replay", response: row.response_body }
    : { outcome: "in-progress" };
}

export async function completeIdempotencyKey(input: {
  readonly userId: string;
  readonly operation: string;
  readonly key: string;
  readonly response: unknown;
}): Promise<void> {
  const { error } = await createAdminClient().rpc("complete_idempotency_key", {
    p_user_id: input.userId,
    p_operation: input.operation,
    p_idempotency_key: input.key,
    p_response_status: 200,
    p_response_body: input.response as never,
  });

  if (error) {
    logger.error({
      event: "playlist.idempotency_complete_failed",
      code: error.code,
    });
  }
}

/** Releases a claim so a failure that never reached Spotify can be retried. */
export async function releaseIdempotencyKey(input: {
  readonly userId: string;
  readonly operation: string;
  readonly key: string;
}): Promise<void> {
  const { error } = await createAdminClient().rpc("release_idempotency_key", {
    p_user_id: input.userId,
    p_operation: input.operation,
    p_idempotency_key: input.key,
  });

  if (error) {
    logger.warn({
      event: "playlist.idempotency_release_failed",
      code: error.code,
    });
  }
}
