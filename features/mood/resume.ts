import { z } from "zod";

import {
  clampLength,
  DEFAULT_CONTROLS,
  PLAYLIST_LENGTH,
  type PlaylistControls,
} from "@/lib/mood/controls";
import type { DraftResult } from "@/features/mood/state";
import type { StoredDraft } from "@/features/playlists/repository";

/**
 * Resuming a draft after a round trip that destroys client state.
 *
 * Connecting to Spotify is a full-document navigation to another origin and
 * back, so every `useState` value in the mood workflow is gone by the time the
 * listener returns. The draft row survives — it is written before Spotify is
 * ever involved — but nothing pointed back at it, so the interface came back
 * empty while the copy promised otherwise.
 *
 * What the URL carries and why it is not the database:
 *
 * `generated_playlists` stores `is_public` but not the requested length or the
 * explicit-content setting. Those two are inputs to *this attempt*, not
 * properties of the saved draft, and defaulting them on the way back would
 * silently reverse a listener's choice to exclude explicit tracks. Carrying
 * them in the return path keeps the round trip faithful without a schema
 * change. They are re-validated on arrival, and the worst a tampered value can
 * do is change a setting the listener owns anyway.
 *
 * This is scoped to the reconnect round trip, which is exactly what the copy
 * promises. Resuming a draft from a link days later would want the columns
 * instead — see the roadmap follow-up.
 */

export const RESUME_PARAMS = {
  draft: "draft",
  length: "length",
  explicit: "explicit",
} as const;

export const resumeParamsSchema = z.object({
  [RESUME_PARAMS.draft]: z.uuid(),
  [RESUME_PARAMS.length]: z.coerce
    .number()
    .int()
    .min(PLAYLIST_LENGTH.min)
    .max(PLAYLIST_LENGTH.max)
    .optional(),
  [RESUME_PARAMS.explicit]: z.enum(["allow", "avoid"]).optional(),
});

export type ResumeParams = z.infer<typeof resumeParamsSchema>;

/** Builds the path the OAuth round trip should return to. */
export function buildResumePath(input: {
  readonly playlistId: string;
  readonly controls: Pick<PlaylistControls, "length" | "explicitContent">;
}): string {
  const query = new URLSearchParams({
    [RESUME_PARAMS.draft]: input.playlistId,
    [RESUME_PARAMS.length]: String(clampLength(input.controls.length)),
    [RESUME_PARAMS.explicit]: input.controls.explicitContent,
  });

  return `/mood?${query.toString()}`;
}

/** Reconstructs the controls for a resumed attempt. */
export function resumedControls(input: {
  readonly params: ResumeParams;
  readonly isPublic: boolean;
}): PlaylistControls {
  return {
    ...DEFAULT_CONTROLS,
    isPublic: input.isPublic,
    length: clampLength(input.params.length ?? DEFAULT_CONTROLS.length),
    explicitContent: input.params.explicit ?? DEFAULT_CONTROLS.explicitContent,
  };
}

export interface ResumedDraft {
  readonly draft: DraftResult;
  /** Restored into the textarea so the page does not come back half empty. */
  readonly moodText: string;
}

/**
 * Maps a stored draft back into the shape the workflow renders.
 *
 * Returns null for anything that is not still a draft. A row that has moved to
 * `creating`, `created`, `partial` or `failed` is not editable, and presenting
 * it with a "Create playlist" button would invite a second creation of
 * something that already exists.
 */
export function toResumableDraft(input: {
  readonly stored: StoredDraft;
  readonly controls: PlaylistControls;
}): ResumedDraft | null {
  const { stored, controls } = input;

  if (stored.status !== "draft" || stored.tracks.length === 0) {
    return null;
  }

  const draft: DraftResult = {
    status: "ready",
    playlistId: stored.playlistId,
    title: stored.title,
    description: stored.description,
    controls,
    // Not stored: this describes the expansion that built the draft, not the
    // draft. Omitting it drops a note; inventing it would be a claim.
    artistsWithoutTracks: [],
    isShort: stored.tracks.length < controls.length,
    tracks: stored.tracks.map((track) => ({
      id: track.id,
      position: track.position,
      recordingMbid: track.recordingMbid,
      title: track.title,
      artistMbid: track.artistMbid,
      artistName: track.artistName,
      releaseTitle: track.releaseTitle,
    })),
  };

  return { draft, moodText: stored.moodText };
}
