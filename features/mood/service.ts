import "server-only";

import { getAiProvider } from "@/lib/ai";
import { AiBoundaryViolationError } from "@/lib/ai/gateway";
import { AiUsageLimitError, claimAiUsage } from "@/lib/ai/limits";
import { AiProviderError } from "@/lib/ai/provider";
import {
  fallbackPlaylistDescription,
  fallbackPlaylistTitle,
} from "@/lib/ai/fallbacks";
import type { MoodCriteria } from "@/lib/ai/schemas";
import {
  clampLength,
  resolveDecades,
  resolveGenres,
  type PlaylistControls,
} from "@/lib/mood/controls";
import { rankSeedCandidates } from "@/lib/mood/seed-ranking";
import {
  dedupeTracks,
  interleaveByArtist,
  selectArtistTracks,
  selectStudioReleases,
  type TrackCandidateDraft,
} from "@/lib/mood/track-selection";
import { logger } from "@/lib/observability/logger";
import { getDiscoveryProvider } from "@/lib/providers/discovery";
import { DiscoveryProviderError } from "@/lib/providers/discovery/port";
import { getMusicBrainzClient } from "@/lib/providers/musicbrainz";
import { MusicBrainzError } from "@/lib/providers/musicbrainz/client";
import type { SeedOption } from "@/features/mood/state";

/**
 * Mood orchestration.
 *
 * The pipeline, and why each step exists:
 *
 * 1. **AI parses the mood** into application-owned criteria. Only the
 *    listener's words travel.
 * 2. **MusicBrainz tag search finds seed candidates.** Lucene ranks these
 *    badly, so `lib/mood/seed-ranking.ts` re-ranks by community tag votes and
 *    drops catalogue placeholders.
 * 3. **A person confirms the seed.** This is the quality control, not an
 *    optimisation — see docs/product/phase-7-mood-scope.md.
 * 4. **ListenBrainz expands** from the confirmed seed, which is the only
 *    trustworthy ranking signal available.
 * 5. **MusicBrainz supplies the tracks**, from studio releases only. There is
 *    no popularity signal to rank them with, so provenance is shown instead.
 *
 * Spotify is absent from this module entirely. Resolution and creation live in
 * `features/playlists`, which imports no AI module.
 */

/** Bounded so one request cannot spend the MusicBrainz pacing budget. */
const MAX_EXPANSION_ARTISTS = 14;
const MAX_RELEASES_PER_ARTIST = 2;
const MAX_SEED_OPTIONS = 8;

export type MoodFailure =
  | "not-configured"
  | "provider-unavailable"
  | "rate-limited"
  | "limit-reached"
  | "no-tags";

export type MoodServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly failure: MoodFailure;
      readonly message: string;
    };

function classify(error: unknown): MoodServiceResult<never> {
  if (error instanceof MusicBrainzError) {
    return {
      ok: false,
      failure:
        error.kind === "rate-limited" ? "rate-limited" : "provider-unavailable",
      message:
        error.kind === "rate-limited"
          ? "MusicBrainz is rate limiting requests. Try again shortly."
          : "MusicBrainz could not be reached, so no candidates were built.",
    };
  }

  if (error instanceof DiscoveryProviderError) {
    return {
      ok: false,
      failure:
        error.kind === "rate-limited" ? "rate-limited" : "provider-unavailable",
      message:
        "The discovery provider could not be reached, so this mood cannot be expanded right now.",
    };
  }

  throw error;
}

export interface ParsedMood {
  readonly criteria: MoodCriteria;
  readonly tags: readonly string[];
  readonly seeds: readonly SeedOption[];
}

/**
 * Parses the mood and finds seed candidates in one step.
 *
 * A parse with `clarificationNeeded` returns before any provider call: asking
 * for a clarification and simultaneously guessing at results would make the
 * question rhetorical.
 */
export async function parseMoodAndFindSeeds(input: {
  readonly moodText: string;
  readonly controls: PlaylistControls;
  readonly userId: string;
}): Promise<MoodServiceResult<ParsedMood>> {
  const provider = getAiProvider();
  let criteria: MoodCriteria;

  try {
    await claimAiUsage({
      userId: input.userId,
      provider: provider.name,
      operation: "parseMood",
    });

    criteria = await provider.parseMood({ moodText: input.moodText });
  } catch (error) {
    if (error instanceof AiUsageLimitError) {
      return {
        ok: false,
        failure: "limit-reached",
        message: error.message,
      };
    }

    if (error instanceof AiBoundaryViolationError) {
      // Unreachable by construction: the only input is the listener's own text.
      logger.error({
        event: "mood.ai_boundary_violation",
        reason: error.reason,
      });
      return {
        ok: false,
        failure: "provider-unavailable",
        message: "That request could not be sent for interpretation.",
      };
    }

    if (error instanceof AiProviderError) {
      return {
        ok: false,
        failure: "provider-unavailable",
        message:
          "Mood interpretation is unavailable right now, so no criteria were guessed.",
      };
    }

    throw error;
  }

  if (criteria.clarificationNeeded) {
    return { ok: true, value: { criteria, tags: [], seeds: [] } };
  }

  const tags = resolveGenres(criteria, input.controls);

  if (tags.length === 0) {
    return {
      ok: false,
      failure: "no-tags",
      message:
        "That description did not map to any genre CrateCompass can search MusicBrainz for. Add a genre below, or describe the sound more specifically.",
    };
  }

  try {
    const seeds = await findSeedOptions({
      tags,
      controls: input.controls,
    });

    return { ok: true, value: { criteria, tags, seeds } };
  } catch (error) {
    return classify(error);
  }
}

async function findSeedOptions(input: {
  readonly tags: readonly string[];
  readonly controls: PlaylistControls;
}): Promise<readonly SeedOption[]> {
  const client = getMusicBrainzClient();
  const collected = new Map<string, SeedOption>();

  // Tags are searched in order and stop early once there are enough options:
  // each search is a paced request, and the first tag is the one the listener
  // emphasised.
  for (const tag of input.tags.slice(0, 3)) {
    if (collected.size >= MAX_SEED_OPTIONS) break;

    const candidates = await client.searchArtistsByTag({ tag, limit: 25 });

    const ranked = rankSeedCandidates({
      candidates,
      tag,
      avoidMbids: input.controls.avoidArtistMbids,
      limit: MAX_SEED_OPTIONS,
    });

    for (const entry of ranked) {
      if (collected.has(entry.candidate.mbid)) continue;

      collected.set(entry.candidate.mbid, {
        mbid: entry.candidate.mbid,
        name: entry.candidate.name,
        disambiguation: entry.candidate.disambiguation,
        type: entry.candidate.type,
        country: entry.candidate.country,
        tagVotes: entry.tagVotes,
        rankedByRelevanceOnly: entry.rankedByRelevanceOnly,
      });

      if (collected.size >= MAX_SEED_OPTIONS) break;
    }
  }

  return [...collected.values()];
}

export interface BuiltCandidates {
  readonly tracks: readonly TrackCandidateDraft[];
  readonly artistsWithoutTracks: readonly string[];
  readonly title: string;
  readonly description: string;
}

/**
 * Expands a confirmed seed into reviewable track candidates.
 *
 * Title and description are generated **before** any Spotify involvement and
 * from approved inputs only, so ordering alone makes it impossible for a
 * Spotify-derived value to reach that call.
 */
export async function buildCandidates(input: {
  readonly seedMbid: string;
  readonly moodText: string;
  readonly criteria: MoodCriteria;
  readonly controls: PlaylistControls;
  readonly userId: string;
}): Promise<MoodServiceResult<BuiltCandidates>> {
  const client = getMusicBrainzClient();
  const controls = {
    ...input.controls,
    length: clampLength(input.controls.length),
    decades: resolveDecades(input.criteria, input.controls),
  } satisfies PlaylistControls;

  let artistMbids: string[];

  try {
    const similarity = await getDiscoveryProvider().findSimilarArtists({
      mbid: input.seedMbid as never,
      limit: 40,
    });

    const avoid = new Set(controls.avoidArtistMbids);

    artistMbids = [
      // The seed itself belongs in its own playlist.
      input.seedMbid,
      ...controls.includeArtistMbids,
      ...similarity.candidates
        .map((candidate) => candidate.mbid)
        .filter((mbid): mbid is NonNullable<typeof mbid> => mbid !== null),
    ]
      .filter((mbid, index, all) => all.indexOf(mbid) === index)
      .filter((mbid) => !avoid.has(mbid))
      .slice(0, MAX_EXPANSION_ARTISTS);
  } catch (error) {
    return classify(error);
  }

  const drafts: TrackCandidateDraft[] = [];
  const artistsWithoutTracks: string[] = [];

  for (const artistMbid of artistMbids) {
    if (drafts.length >= controls.length * 2) break;

    try {
      const { artist, releases } = await client.lookupArtist(artistMbid);
      const studio = selectStudioReleases({
        releases,
        controls,
        limit: MAX_RELEASES_PER_ARTIST,
      });

      if (studio.length === 0) {
        artistsWithoutTracks.push(artist.name);
        continue;
      }

      const forArtist: TrackCandidateDraft[] = [];

      for (const release of studio) {
        if (forArtist.length >= controls.maxPerArtist) break;

        const tracks = await client.listReleaseGroupTracks(release.mbid);

        forArtist.push(
          ...selectArtistTracks({
            artistMbid,
            artistName: artist.name,
            tracks,
            releaseYear: release.firstReleaseDate.value?.slice(0, 4) ?? null,
            maxTracks: controls.maxPerArtist - forArtist.length,
          }),
        );
      }

      if (forArtist.length === 0) {
        artistsWithoutTracks.push(artist.name);
        continue;
      }

      drafts.push(...forArtist);
    } catch (error) {
      if (!(error instanceof MusicBrainzError)) throw error;

      // One artist's metadata failing must not fail the playlist. It becomes a
      // reported gap instead.
      logger.warn({
        event: "mood.artist_expansion_failed",
        kind: error.kind,
      });
      artistsWithoutTracks.push("an artist whose details could not be read");
    }
  }

  const ordered = interleaveByArtist(dedupeTracks(drafts)).slice(
    0,
    controls.length,
  );

  const { title, description } = await generatePlaylistText({
    moodText: input.moodText,
    criteria: input.criteria,
    userId: input.userId,
  });

  return {
    ok: true,
    value: {
      tracks: ordered,
      artistsWithoutTracks,
      title,
      description,
    },
  };
}

/**
 * Playlist title and description.
 *
 * Failure here is never fatal: a playlist with a plain title is a working
 * playlist, so both calls degrade to the deterministic fallbacks rather than
 * losing the candidates the listener just reviewed.
 */
async function generatePlaylistText(input: {
  readonly moodText: string;
  readonly criteria: MoodCriteria;
  readonly userId: string;
}): Promise<{ readonly title: string; readonly description: string }> {
  const provider = getAiProvider();
  const payload = { moodText: input.moodText, criteria: input.criteria };

  try {
    await claimAiUsage({
      userId: input.userId,
      provider: provider.name,
      operation: "generatePlaylistTitle",
    });

    const [title, description] = await Promise.all([
      provider.generatePlaylistTitle(payload),
      provider.generatePlaylistDescription(payload),
    ]);

    return { title: title.title, description: description.description };
  } catch (error) {
    if (
      !(error instanceof AiProviderError) &&
      !(error instanceof AiUsageLimitError) &&
      !(error instanceof AiBoundaryViolationError)
    ) {
      throw error;
    }

    logger.info({ event: "mood.playlist_text_fallback" });

    return {
      title: fallbackPlaylistTitle(input.moodText).title,
      description: fallbackPlaylistDescription(input.criteria).description,
    };
  }
}
