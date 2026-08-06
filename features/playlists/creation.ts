import "server-only";

import { resolveSpotifyTrack } from "@/lib/matching/track-resolution";
import { logger } from "@/lib/observability/logger";
import { PLAYLIST_ITEM_BATCH_LIMIT } from "@/lib/providers/spotify/client";
import { getSpotifyPort } from "@/lib/providers/spotify";
import {
  asSpotifyResourceId,
  asSpotifyUri,
  SpotifyProviderError,
} from "@/lib/providers/spotify/types";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  digestRequest,
  markCreating,
  markDraftFailed,
  readDraft,
  recordCreationOutcome,
  releaseIdempotencyKey,
  updateTrackResolution,
} from "@/features/playlists/repository";
import { REAUTHORIZATION_COPY } from "@/features/spotify/reauthorization-copy";
import type { CreationResult } from "@/features/mood/state";

/**
 * Playlist creation.
 *
 * This is the first irreversible outward action in the product, so the ordering
 * is chosen around one question: what happens if this is interrupted, retried,
 * or double-submitted?
 *
 *   claim key -> resolve tracks -> create playlist -> add in batches -> record
 *
 * - **Resolution before creation.** A resolution failure then leaves nothing
 *   behind in the listener's Spotify account.
 * - **The key is claimed first and released on any failure that happened
 *   before Spotify was called.** Holding it after a failed attempt would tell
 *   the listener they had already created a playlist that does not exist.
 * - **A confirmed creation is never reported as failed.** If items only
 *   partially added, the outcome is `partial`, with counts the listener can
 *   check against Spotify.
 *
 * No AI module is imported here, and none may be.
 */

const OPERATION = "create-playlist";
const SPOTIFY_PLAYLIST_URL = "https://open.spotify.com/playlist/";

export async function createPlaylistFromDraft(input: {
  readonly userId: string;
  readonly playlistId: string;
  readonly idempotencyKey: string;
  readonly avoidExplicit: boolean;
}): Promise<CreationResult> {
  const draft = await readDraft({
    userId: input.userId,
    playlistId: input.playlistId,
  });

  if (!draft) {
    return {
      status: "failed",
      message: "That playlist draft no longer exists.",
    };
  }

  if (draft.tracks.length === 0) {
    return {
      status: "failed",
      message: "A playlist needs at least one track.",
    };
  }

  const claim = await claimIdempotencyKey({
    userId: input.userId,
    operation: OPERATION,
    key: input.idempotencyKey,
    requestDigest: digestRequest({
      playlistId: draft.playlistId,
      trackIds: draft.tracks.map((track) => track.id),
      isPublic: draft.isPublic,
    }),
  });

  if (claim.outcome === "replay") {
    // The same submission already completed. Return what it returned rather
    // than creating a second playlist.
    return claim.response as CreationResult;
  }

  if (claim.outcome === "in-progress") {
    return {
      status: "in-progress",
      message:
        "This playlist is already being created. Give it a moment rather than submitting again.",
    };
  }

  if (claim.outcome === "conflict") {
    return {
      status: "failed",
      message:
        "This playlist was submitted with different contents. Reload the draft and try again.",
    };
  }

  const spotify = getSpotifyPort();
  let accessToken: string;

  try {
    accessToken = await spotify.getAccessToken(input.userId);
  } catch (error) {
    await releaseIdempotencyKey({
      userId: input.userId,
      operation: OPERATION,
      key: input.idempotencyKey,
    });

    if (!(error instanceof SpotifyProviderError)) throw error;

    if (error.kind === "insufficient-scope") {
      return {
        status: "reconnect-required",
        message: `${REAUTHORIZATION_COPY.playlistBlocked.body} ${REAUTHORIZATION_COPY.playlistBlocked.reassurance}`,
      };
    }

    if (error.kind === "reauthorization-required") {
      return {
        status: "spotify-not-connected",
        message: "Connect Spotify to create this playlist.",
      };
    }

    return {
      status: "failed",
      message: "Spotify could not be reached. Nothing was created.",
    };
  }

  await markCreating({
    userId: input.userId,
    playlistId: draft.playlistId,
    idempotencyKey: input.idempotencyKey,
  });

  const resolved: { readonly trackId: string; readonly uri: string }[] = [];
  const unresolved: string[] = [];

  for (const track of draft.tracks) {
    try {
      const results = await spotify.search(accessToken, {
        query: `track:"${track.title}" artist:"${track.artistName}"`,
        types: ["track"],
      });

      const resolution = resolveSpotifyTrack({
        title: track.title,
        artistName: track.artistName,
        avoidExplicit: input.avoidExplicit,
        options: results.tracks.map((match) => ({
          id: match.id,
          uri: match.uri,
          name: match.name,
          artistNames: match.artistNames,
          isExplicit: match.isExplicit,
        })),
      });

      if (resolution.confidence === "confident" && resolution.selected) {
        resolved.push({ trackId: track.id, uri: resolution.selected.uri });
        continue;
      }

      unresolved.push(`${track.title} — ${track.artistName}`);
      await updateTrackResolution({
        userId: input.userId,
        trackId: track.id,
        spotifyUri: null,
        status: "unresolved",
      });
    } catch (error) {
      if (!(error instanceof SpotifyProviderError)) throw error;

      logger.warn({ event: "playlist.track_search_failed", kind: error.kind });
      unresolved.push(`${track.title} — ${track.artistName}`);
      await updateTrackResolution({
        userId: input.userId,
        trackId: track.id,
        spotifyUri: null,
        status: "unresolved",
      });
    }
  }

  if (resolved.length === 0) {
    await markDraftFailed({
      userId: input.userId,
      playlistId: draft.playlistId,
      failureCode: "no-tracks-resolved",
    });
    await releaseIdempotencyKey({
      userId: input.userId,
      operation: OPERATION,
      key: input.idempotencyKey,
    });

    return {
      status: "failed",
      message:
        "None of these recordings could be matched on Spotify, so no playlist was created.",
    };
  }

  let created: { readonly id: string; readonly uri: string };

  try {
    const playlist = await spotify.createPlaylist(accessToken, {
      name: draft.title,
      description: draft.description,
      isPublic: draft.isPublic,
    });
    created = { id: playlist.id, uri: playlist.uri };
  } catch (error) {
    await markDraftFailed({
      userId: input.userId,
      playlistId: draft.playlistId,
      failureCode: "create-failed",
    });
    await releaseIdempotencyKey({
      userId: input.userId,
      operation: OPERATION,
      key: input.idempotencyKey,
    });

    if (!(error instanceof SpotifyProviderError)) throw error;

    return {
      status: "failed",
      message:
        error.kind === "insufficient-scope"
          ? REAUTHORIZATION_COPY.playlistBlocked.body
          : "Spotify did not create the playlist. Nothing was added.",
    };
  }

  // Past this point the playlist exists in the listener's account, so no
  // failure below may be reported as "nothing happened".
  const playlistUrl = `${SPOTIFY_PLAYLIST_URL}${created.id}`;
  let added = 0;

  for (
    let index = 0;
    index < resolved.length;
    index += PLAYLIST_ITEM_BATCH_LIMIT
  ) {
    const batch = resolved.slice(index, index + PLAYLIST_ITEM_BATCH_LIMIT);

    try {
      await spotify.addPlaylistItems(accessToken, {
        playlistId: asSpotifyResourceId(created.id),
        uris: batch.map((entry) => asSpotifyUri(entry.uri)),
      });

      for (const entry of batch) {
        await updateTrackResolution({
          userId: input.userId,
          trackId: entry.trackId,
          spotifyUri: entry.uri,
          status: "added",
        });
      }

      added += batch.length;
    } catch (error) {
      if (!(error instanceof SpotifyProviderError)) throw error;

      logger.warn({ event: "playlist.batch_add_failed", kind: error.kind });

      for (const entry of batch) {
        await updateTrackResolution({
          userId: input.userId,
          trackId: entry.trackId,
          spotifyUri: entry.uri,
          status: "failed",
        });
      }
    }
  }

  const isComplete = added === draft.tracks.length;

  await recordCreationOutcome({
    userId: input.userId,
    playlistId: draft.playlistId,
    spotifyPlaylistId: created.id,
    spotifyUrl: playlistUrl,
    tracksAdded: added,
    status: isComplete ? "created" : "partial",
    failureCode: isComplete ? null : "partial-add",
  });

  const result: CreationResult = isComplete
    ? {
        status: "created",
        playlistUrl,
        trackTotal: draft.tracks.length,
        tracksAdded: added,
      }
    : {
        status: "partial",
        playlistUrl,
        trackTotal: draft.tracks.length,
        tracksAdded: added,
        unresolved,
        message:
          added === 0
            ? "The playlist was created in Spotify but no tracks could be added to it."
            : `The playlist was created with ${added} of ${draft.tracks.length} tracks. The rest could not be matched or added.`,
      };

  await completeIdempotencyKey({
    userId: input.userId,
    operation: OPERATION,
    key: input.idempotencyKey,
    response: result,
  });

  logger.info({
    event: "playlist.created",
    status: result.status,
    trackTotal: draft.tracks.length,
    tracksAdded: added,
  });

  return result;
}
