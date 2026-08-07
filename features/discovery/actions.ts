"use server";

import { z } from "zod";

import {
  dismissCandidate,
  removeSavedArtist,
  restoreCandidate,
  saveDiscoveredArtist,
} from "@/features/discovery/repository";
import {
  explainCandidate,
  loadDiscoveryPage,
  loadSeedArtist,
} from "@/features/discovery/service";
import type {
  DismissState,
  ExplanationResult,
  LoadMoreResult,
  SaveState,
} from "@/features/discovery/state";
import { getAiProvider } from "@/lib/ai";
import { aiInputDisclosure } from "@/lib/ai/disclosure";
import { MAX_USER_TEXT_LENGTH } from "@/lib/ai/schemas";
import { toExplanationColumns } from "@/lib/library/explanation-snapshot";
import { logger } from "@/lib/observability/logger";
import { getOptionalUser } from "@/lib/supabase/auth";

/**
 * Server actions for the discovery surface.
 *
 * Two properties every action here holds to:
 *
 * - **Inputs are parsed, not trusted.** A server action is a public POST
 *   endpoint. Anything arriving here may have been crafted by hand, so
 *   identifiers are validated as UUIDs and free text is length-capped before it
 *   reaches a provider or the database.
 * - **Anonymous is a state, not an error.** Discovery is browsable without an
 *   account, so an action that needs one returns `auth-required` for the UI to
 *   render in place. Redirecting mid-interaction would discard the listener's
 *   position in a long result list.
 *
 * No action in this file imports a Spotify module. Opening a result in Spotify
 * is `features/spotify/actions.ts`, which imports no AI module. The two
 * capabilities never meet in one file.
 */

const mbidSchema = z.uuid();
const nameSchema = z.string().trim().min(1).max(255);

/**
 * The explanation on screen when Save was pressed.
 *
 * It arrives from the browser because that is where the displayed explanation
 * is, and regenerating it server-side would spend an AI request and could
 * return different prose than the listener actually read. It is bounded here
 * rather than trusted: a server action is a public endpoint, and these strings
 * are written to a row and rendered back later.
 */
const explanationSnapshotSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  sharedCharacteristics: z.array(z.string().trim().min(1).max(400)).max(10),
  contrast: z.string().trim().max(1000).nullable(),
  startingPoint: z
    .object({
      releaseId: z.string().trim().min(1).max(64),
      title: z.string().trim().min(1).max(300),
      year: z.string().trim().max(4).nullable(),
      primaryType: z.string().trim().max(40).nullable(),
      sourceUrl: z.string().trim().max(1000).nullable(),
    })
    .nullable(),
  source: z.enum(["ai", "template"]),
  provider: z.string().trim().max(40).nullable(),
  model: z.string().trim().max(255).nullable(),
});

const saveInputSchema = z.object({
  mbid: mbidSchema,
  name: nameSchema,
  sourceUrl: z.string().trim().max(1000).nullable(),
  explanation: explanationSnapshotSchema.nullable().optional(),
});

const dismissInputSchema = z.object({
  seedMbid: mbidSchema,
  candidateMbid: mbidSchema,
  candidateName: nameSchema,
});

const explainInputSchema = z.object({
  seedMbid: mbidSchema,
  candidateMbid: mbidSchema,
  listenerPreference: z
    .string()
    .trim()
    .max(MAX_USER_TEXT_LENGTH)
    .nullable()
    .transform((value) => (value && value.length > 0 ? value : null)),
});

const loadMoreInputSchema = z.object({
  seedMbid: mbidSchema,
  offset: z.number().int().min(0).max(500),
});

const AUTH_REQUIRED = "Sign in to keep this discovery in your library.";
const INVALID_REQUEST = "That request could not be understood.";

export async function saveDiscoveryAction(input: unknown): Promise<SaveState> {
  const parsed = saveInputSchema.safeParse(input);

  if (!parsed.success) {
    return { status: "error", message: INVALID_REQUEST };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { status: "auth-required", message: AUTH_REQUIRED };
  }

  const supplied = parsed.data.explanation;

  const outcome = await saveDiscoveredArtist({
    userId: user.id,
    mbid: parsed.data.mbid,
    name: parsed.data.name,
    sourceReference: parsed.data.sourceUrl,
    ...(supplied
      ? {
          explanation: toExplanationColumns({
            explanation: {
              source: supplied.source,
              summary: supplied.summary,
              sharedCharacteristics: supplied.sharedCharacteristics,
              contrast: supplied.contrast,
              startingPoint: supplied.startingPoint,
              // Not stored: the verification trace did its job before this
              // explanation was ever displayed.
              groundedIn: [],
              confidence: "medium",
              model: supplied.model,
            },
            provider: supplied.provider,
          }),
        }
      : {}),
  });

  if (outcome === "failed") {
    return {
      status: "error",
      message: "That could not be saved. Try again shortly.",
    };
  }

  return outcome === "already-present"
    ? { status: "already-saved", message: "Already in your library." }
    : { status: "saved", message: "Saved to your library." };
}

export async function unsaveDiscoveryAction(
  input: unknown,
): Promise<SaveState> {
  const parsed = z.object({ mbid: mbidSchema }).safeParse(input);

  if (!parsed.success) {
    return { status: "error", message: INVALID_REQUEST };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { status: "auth-required", message: AUTH_REQUIRED };
  }

  const removed = await removeSavedArtist({
    userId: user.id,
    mbid: parsed.data.mbid,
  });

  return removed
    ? { status: "removed", message: "Removed from your library." }
    : {
        status: "error",
        message: "That could not be removed. Try again shortly.",
      };
}

export async function dismissDiscoveryAction(
  input: unknown,
): Promise<DismissState> {
  const parsed = dismissInputSchema.safeParse(input);

  if (!parsed.success) {
    return { status: "error", message: INVALID_REQUEST };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return {
      status: "auth-required",
      message: "Sign in to hide a suggestion for good.",
    };
  }

  const outcome = await dismissCandidate({
    userId: user.id,
    seedMbid: parsed.data.seedMbid,
    candidateMbid: parsed.data.candidateMbid,
    candidateName: parsed.data.candidateName,
  });

  return outcome === "failed"
    ? {
        status: "error",
        message: "That could not be dismissed. Try again shortly.",
      }
    : { status: "dismissed", message: "Dismissed for this artist." };
}

export async function restoreDiscoveryAction(
  input: unknown,
): Promise<DismissState> {
  const parsed = z
    .object({ seedMbid: mbidSchema, candidateMbid: mbidSchema })
    .safeParse(input);

  if (!parsed.success) {
    return { status: "error", message: INVALID_REQUEST };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return { status: "auth-required", message: AUTH_REQUIRED };
  }

  const restored = await restoreCandidate({
    userId: user.id,
    seedMbid: parsed.data.seedMbid,
    candidateMbid: parsed.data.candidateMbid,
  });

  return restored
    ? { status: "restored", message: "Suggestion restored." }
    : {
        status: "error",
        message: "That could not be restored. Try again shortly.",
      };
}

export async function explainDiscoveryAction(
  input: unknown,
): Promise<ExplanationResult> {
  const parsed = explainInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "failed",
      failure: "not-found",
      message: INVALID_REQUEST,
    };
  }

  const { user } = await getOptionalUser();
  const seed = await loadSeedArtist(parsed.data.seedMbid);

  if (!seed.ok) {
    return {
      status: "failed",
      failure: seed.failure,
      message: seed.message,
    };
  }

  const result = await explainCandidate({
    seed: seed.value,
    candidateMbid: parsed.data.candidateMbid,
    listenerPreference: parsed.data.listenerPreference,
    userId: user?.id ?? null,
  });

  if (!result.ok) {
    return {
      status: "failed",
      failure: result.failure,
      message: result.message,
    };
  }

  logger.info({
    event: "discovery.explanation_served",
    source: result.value.status,
    depth: result.value.evidence.depth,
  });

  return {
    status: "ready",
    evidence: result.value.evidence,
    explanation: result.value.explanation,
    source: result.value.status,
    inputDisclosure: aiInputDisclosure(getAiProvider().name),
  };
}

export async function loadMoreCandidatesAction(
  input: unknown,
): Promise<LoadMoreResult> {
  const parsed = loadMoreInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "failed",
      failure: "not-found",
      message: INVALID_REQUEST,
    };
  }

  const { user } = await getOptionalUser();
  const seed = await loadSeedArtist(parsed.data.seedMbid);

  if (!seed.ok) {
    return { status: "failed", failure: seed.failure, message: seed.message };
  }

  const page = await loadDiscoveryPage({
    seed: seed.value.artist,
    offset: parsed.data.offset,
    userId: user?.id ?? null,
  });

  if (!page.ok) {
    return { status: "failed", failure: page.failure, message: page.message };
  }

  return {
    status: "ready",
    candidates: page.value.candidates,
    hasMore: page.value.hasMore,
    nextOffset: page.value.nextOffset,
  };
}
