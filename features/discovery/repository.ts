import "server-only";

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Discovery persistence.
 *
 * Every statement here runs through the request-scoped client, so Row Level
 * Security is the authority on which rows are visible — the `user_id` filters
 * are a second, explicit statement of intent, not the security control.
 *
 * What is deliberately absent: any Spotify field. Discovery stores MusicBrainz
 * identifiers and user decisions. Spotify resolution is recomputed per request
 * so nothing here can drift out of date or become an unlicensed catalogue
 * mirror.
 */

export type DiscoveryWriteOutcome = "saved" | "already-present" | "failed";

/** Postgres unique violation. Expected on double-submit, not an error state. */
const UNIQUE_VIOLATION = "23505";

export async function readDismissedCandidates(input: {
  readonly userId: string;
  readonly seedMbid: string;
}): Promise<ReadonlySet<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dismissed_discoveries")
    .select("candidate_artist_mbid")
    .eq("user_id", input.userId)
    .eq("seed_artist_mbid", input.seedMbid);

  if (error) {
    // A failed read must not hide results: showing a dismissed candidate again
    // is a smaller harm than showing nothing at all.
    logger.warn({ event: "discovery.dismissed_read_failed", code: error.code });
    return new Set();
  }

  return new Set(data.map((row) => row.candidate_artist_mbid));
}

export async function readSavedCandidates(input: {
  readonly userId: string;
  readonly mbids: readonly string[];
}): Promise<ReadonlySet<string>> {
  if (input.mbids.length === 0) {
    return new Set();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("favorite_discoveries")
    .select("canonical_artist_id")
    .eq("user_id", input.userId)
    .eq("source_type", "artist")
    .in("canonical_artist_id", [...input.mbids]);

  if (error) {
    logger.warn({ event: "discovery.saved_read_failed", code: error.code });
    return new Set();
  }

  return new Set(
    data
      .map((row) => row.canonical_artist_id)
      .filter((value): value is string => value !== null),
  );
}

export async function saveDiscoveredArtist(input: {
  readonly userId: string;
  readonly mbid: string;
  readonly name: string;
  readonly sourceReference: string | null;
}): Promise<DiscoveryWriteOutcome> {
  const supabase = await createClient();
  const { error } = await supabase.from("favorite_discoveries").insert({
    user_id: input.userId,
    artist_name: input.name,
    canonical_artist_id: input.mbid,
    source_type: "artist",
    source_reference: input.sourceReference,
  });

  if (error?.code === UNIQUE_VIOLATION) {
    // The partial unique index doing its job. Saving twice is a no-op, which
    // is what makes the action safe to retry.
    return "already-present";
  }

  if (error) {
    logger.error({ event: "discovery.save_failed", code: error.code });
    return "failed";
  }

  return "saved";
}

export async function removeSavedArtist(input: {
  readonly userId: string;
  readonly mbid: string;
}): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("favorite_discoveries")
    .delete()
    .eq("user_id", input.userId)
    .eq("source_type", "artist")
    .eq("canonical_artist_id", input.mbid);

  if (error) {
    logger.error({ event: "discovery.unsave_failed", code: error.code });
    return false;
  }

  return true;
}

export async function dismissCandidate(input: {
  readonly userId: string;
  readonly seedMbid: string;
  readonly candidateMbid: string;
  readonly candidateName: string;
}): Promise<DiscoveryWriteOutcome> {
  const supabase = await createClient();
  const { error } = await supabase.from("dismissed_discoveries").insert({
    user_id: input.userId,
    seed_artist_mbid: input.seedMbid,
    candidate_artist_mbid: input.candidateMbid,
    candidate_name: input.candidateName,
  });

  if (error?.code === UNIQUE_VIOLATION) {
    return "already-present";
  }

  if (error) {
    logger.error({ event: "discovery.dismiss_failed", code: error.code });
    return "failed";
  }

  return "saved";
}

export async function restoreCandidate(input: {
  readonly userId: string;
  readonly seedMbid: string;
  readonly candidateMbid: string;
}): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("dismissed_discoveries")
    .delete()
    .eq("user_id", input.userId)
    .eq("seed_artist_mbid", input.seedMbid)
    .eq("candidate_artist_mbid", input.candidateMbid);

  if (error) {
    logger.error({ event: "discovery.restore_failed", code: error.code });
    return false;
  }

  return true;
}

/**
 * Discovery history is deliberately not written here.
 *
 * A session row per page render would record "looked at this again" as a
 * distinct discovery event, and there is no UI, retention rule, or deletion
 * control for that data until Phase 9. Writing it now would accumulate records
 * a user can neither see nor clear, which is the wrong order to build a
 * privacy-relevant feature in.
 */
