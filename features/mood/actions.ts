"use server";

import { z } from "zod";

import { aiInputDisclosure } from "@/lib/ai/disclosure";
import { getAiProvider } from "@/lib/ai";
import { MAX_USER_TEXT_LENGTH } from "@/lib/ai/schemas";
import {
  clampLength,
  DEFAULT_CONTROLS,
  summarizeControls,
  type PlaylistControls,
} from "@/lib/mood/controls";
import {
  buildCandidates,
  parseMoodAndFindSeeds,
} from "@/features/mood/service";
import type { DraftResult, MoodParseResult } from "@/features/mood/state";
import {
  readDraft,
  removeDraftTrack,
  saveDraft,
} from "@/features/playlists/repository";
import { getOptionalUser } from "@/lib/supabase/auth";

/**
 * Mood server actions.
 *
 * Same two properties as the discovery actions: inputs are parsed rather than
 * trusted, because a server action is a public endpoint; and every outcome is a
 * named member of a closed union so the interface can render it.
 *
 * Unlike discovery, these require an account. Mood parsing spends metered AI
 * usage and produces a durable draft, neither of which an anonymous caller has
 * anywhere to charge or keep.
 */

const AUTH_REQUIRED = "Sign in to build a playlist from a mood.";

const controlsSchema = z
  .object({
    length: z.number().int().min(1).max(200).transform(clampLength),
    isPublic: z.boolean(),
    genres: z.array(z.string().trim().min(1).max(60)).max(8),
    decades: z.array(z.number().int().min(1900).max(2100)).max(6),
    explicitContent: z.enum(["allow", "avoid"]),
    includeArtistMbids: z.array(z.uuid()).max(10),
    avoidArtistMbids: z.array(z.uuid()).max(20),
    maxPerArtist: z.number().int().min(1).max(5),
  })
  .strict();

const parseInputSchema = z
  .object({
    moodText: z.string().trim().min(1).max(MAX_USER_TEXT_LENGTH),
    controls: controlsSchema.partial().optional(),
  })
  .strict();

const buildInputSchema = z
  .object({
    moodText: z.string().trim().min(1).max(MAX_USER_TEXT_LENGTH),
    seedMbid: z.uuid(),
    controls: controlsSchema.partial().optional(),
  })
  .strict();

type SuppliedControls = {
  readonly [K in keyof PlaylistControls]?: PlaylistControls[K] | undefined;
};

/**
 * Spreading the parsed object directly would be wrong under
 * `exactOptionalPropertyTypes`: an absent field arrives as an explicit
 * `undefined` and would overwrite the default rather than leave it alone.
 */
function mergeControls(
  partial: SuppliedControls | undefined,
): PlaylistControls {
  const merged: Record<string, unknown> = { ...DEFAULT_CONTROLS };

  for (const [key, value] of Object.entries(partial ?? {})) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged as unknown as PlaylistControls;
}

export async function parseMoodAction(
  input: unknown,
): Promise<MoodParseResult> {
  const parsed = parseInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "failed",
      message: "That description could not be read. Try rephrasing it.",
    };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { status: "failed", message: AUTH_REQUIRED };
  }

  const controls = mergeControls(parsed.data.controls);

  const result = await parseMoodAndFindSeeds({
    moodText: parsed.data.moodText,
    controls,
    userId: user.id,
  });

  if (!result.ok) {
    return { status: "failed", message: result.message };
  }

  const { criteria, tags, seeds } = result.value;

  if (criteria.clarificationNeeded) {
    return {
      status: "clarify",
      // The schema permits a null question; falling back keeps the interface
      // from rendering an empty prompt.
      question:
        criteria.clarificationQuestion ??
        "Which artists or genres should this lean towards?",
      criteria,
    };
  }

  return {
    status: "ready",
    criteria,
    summary: summarizeControls(criteria, controls),
    tags,
    seeds,
    emptyReason:
      seeds.length === 0
        ? `MusicBrainz has no artists tagged ${tags.join(" or ")}. Try a broader genre.`
        : null,
    inputDisclosure: aiInputDisclosure(getAiProvider().name),
  };
}

export async function buildDraftAction(input: unknown): Promise<DraftResult> {
  const parsed = buildInputSchema.safeParse(input);

  if (!parsed.success) {
    return { status: "failed", message: "That selection could not be read." };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { status: "failed", message: AUTH_REQUIRED };
  }

  const controls = mergeControls(parsed.data.controls);

  // Parsing runs again rather than trusting criteria round-tripped through the
  // browser: the criteria decide what is searched, and a caller must not be
  // able to hand-craft them.
  const parseResult = await parseMoodAndFindSeeds({
    moodText: parsed.data.moodText,
    controls,
    userId: user.id,
  });

  if (!parseResult.ok) {
    return { status: "failed", message: parseResult.message };
  }

  const built = await buildCandidates({
    seedMbid: parsed.data.seedMbid,
    moodText: parsed.data.moodText,
    criteria: parseResult.value.criteria,
    controls,
    userId: user.id,
  });

  if (!built.ok) {
    return { status: "failed", message: built.message };
  }

  if (built.value.tracks.length === 0) {
    return {
      status: "failed",
      message:
        "No studio recordings could be found for these artists, so there is nothing to review. Try a different seed artist.",
    };
  }

  const tracks = built.value.tracks.map((track, index) => ({
    position: index + 1,
    recordingMbid: track.recordingMbid,
    artistMbid: track.artistMbid,
    title: track.title,
    artistName: track.artistName,
    releaseTitle: track.releaseTitle,
  }));

  const playlistId = await saveDraft({
    userId: user.id,
    moodText: parsed.data.moodText,
    title: built.value.title,
    description: built.value.description,
    isPublic: controls.isPublic,
    tracks,
  });

  if (!playlistId) {
    return {
      status: "failed",
      message: "The draft could not be saved. Try again shortly.",
    };
  }

  // Re-read rather than synthesising identifiers: the interface removes tracks
  // by row id, so it must hold the ids the database actually assigned.
  const stored = await readDraft({ userId: user.id, playlistId });

  if (!stored) {
    return {
      status: "failed",
      message: "The draft was saved but could not be read back.",
    };
  }

  return {
    status: "ready",
    playlistId,
    title: stored.title,
    description: stored.description,
    controls,
    artistsWithoutTracks: built.value.artistsWithoutTracks,
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
}

export async function removeDraftTrackAction(
  input: unknown,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const parsed = z
    .object({ playlistId: z.uuid(), trackId: z.uuid() })
    .safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That track could not be identified." };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { ok: false, message: AUTH_REQUIRED };
  }

  const removed = await removeDraftTrack({
    userId: user.id,
    playlistId: parsed.data.playlistId,
    trackId: parsed.data.trackId,
  });

  return removed
    ? { ok: true, message: "Removed from the draft." }
    : { ok: false, message: "That track could not be removed." };
}
