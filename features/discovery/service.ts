import "server-only";

import { AiUsageLimitError, claimAiUsage } from "@/lib/ai/limits";
import { AiBoundaryViolationError } from "@/lib/ai/gateway";
import { getAiProvider } from "@/lib/ai";
import { AiProviderError } from "@/lib/ai/provider";
import { buildMatchEvidence } from "@/lib/discovery/evidence";
import {
  buildTemplateExplanation,
  verifyExplanation,
} from "@/lib/discovery/explanation";
import type {
  DiscoveryCandidate,
  DiscoveryExplanation,
  MatchEvidence,
  StartingPoint,
} from "@/lib/discovery/types";
import { logger } from "@/lib/observability/logger";
import { getDiscoveryProvider } from "@/lib/providers/discovery";
import { DiscoveryProviderError } from "@/lib/providers/discovery/port";
import {
  MusicBrainzError,
  type CanonicalArtistWithDiscography,
} from "@/lib/providers/musicbrainz/client";
import { getMusicBrainzClient } from "@/lib/providers/musicbrainz";
import {
  readDismissedCandidates,
  readSavedCandidates,
} from "@/features/discovery/repository";
import type {
  ArtistSearchCandidate,
  CanonicalArtist,
  DiscographyRelease,
  SourceAttribution,
} from "@/types/music";

/**
 * Discovery orchestration.
 *
 * The order of operations is the compliance story: the discovery provider
 * decides *who* is related, MusicBrainz says *what is true* about them,
 * deterministic code turns that into evidence, and only then may AI write
 * prose about evidence that already exists. Spotify appears nowhere in this
 * module — resolution and linking live in `features/spotify`, which has no AI
 * imports, so no single module can carry data from one side to the other.
 *
 * ## Why candidate metadata is fetched on demand
 *
 * MusicBrainz is paced at one request per second. Enriching a page of twelve
 * candidates up front would block the first render for twelve seconds. Instead
 * the result list renders from similarity data alone, and a candidate's
 * MusicBrainz record is fetched when the listener opens its explanation. The
 * partial state this creates is shown honestly rather than hidden.
 */

export const DISCOVERY_PAGE_SIZE = 12;
/** One provider call serves several pages; ListenBrainz returns up to 100. */
const CANDIDATE_FETCH_LIMIT = 60;
const MAX_RELEASES_FOR_EXPLANATION = 12;

export type DiscoveryFailure =
  "not-configured" | "not-found" | "rate-limited" | "provider-unavailable";

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly failure: DiscoveryFailure;
      readonly message: string;
    };

function failure<T>(kind: DiscoveryFailure, message: string): ServiceResult<T> {
  return { ok: false, failure: kind, message };
}

function classifyProviderError(error: unknown): ServiceResult<never> {
  if (error instanceof MusicBrainzError) {
    if (error.kind === "not-found") {
      return failure(
        "not-found",
        "MusicBrainz has no artist with that identifier.",
      );
    }
    if (error.kind === "rate-limited") {
      return failure(
        "rate-limited",
        "MusicBrainz is rate limiting requests. Try again shortly.",
      );
    }
    if (error.kind === "not-configured") {
      return failure(
        "not-configured",
        "The MusicBrainz integration is not configured for this deployment.",
      );
    }
    return failure(
      "provider-unavailable",
      "MusicBrainz could not be reached. Nothing has been guessed in its place.",
    );
  }

  if (error instanceof DiscoveryProviderError) {
    if (error.kind === "not-configured") {
      return failure(
        "not-configured",
        "The discovery provider is not configured for this deployment.",
      );
    }
    if (error.kind === "rate-limited") {
      return failure(
        "rate-limited",
        "The discovery provider is rate limiting requests. Try again shortly.",
      );
    }
    return failure(
      "provider-unavailable",
      "The discovery provider could not be reached. Artist details below are still accurate.",
    );
  }

  throw error;
}

export async function searchCanonicalArtists(
  query: string,
): Promise<ServiceResult<readonly ArtistSearchCandidate[]>> {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return { ok: true, value: [] };
  }

  try {
    const candidates = await getMusicBrainzClient().searchArtists(trimmed, {
      limit: 10,
    });
    return { ok: true, value: candidates };
  } catch (error) {
    return classifyProviderError(error);
  }
}

/**
 * Re-exported from the client so the completeness fields cannot be dropped on
 * the way through. They were added because the MusicBrainz lookup silently
 * truncates release groups at 25, and a consumer that states a count needs to
 * know whether it has all of them.
 */
export type SeedArtist = CanonicalArtistWithDiscography;

export async function loadSeedArtist(
  mbid: string,
): Promise<ServiceResult<SeedArtist>> {
  try {
    return { ok: true, value: await getMusicBrainzClient().lookupArtist(mbid) };
  } catch (error) {
    return classifyProviderError(error);
  }
}

export interface DiscoveryPage {
  readonly seed: CanonicalArtist;
  readonly candidates: readonly DiscoveryCandidate[];
  /** Candidates the provider returned, before dismissals are removed. */
  readonly reportedCount: number;
  readonly dismissedCount: number;
  readonly hasMore: boolean;
  readonly nextOffset: number;
  readonly attribution: SourceAttribution;
  readonly algorithm: string;
}

export async function loadDiscoveryPage(input: {
  readonly seed: CanonicalArtist;
  readonly offset: number;
  readonly userId: string | null;
}): Promise<ServiceResult<DiscoveryPage>> {
  let evidence;

  try {
    evidence = await getDiscoveryProvider().findSimilarArtists({
      mbid: input.seed.mbid,
      limit: CANDIDATE_FETCH_LIMIT,
    });
  } catch (error) {
    return classifyProviderError(error);
  }

  const dismissed = input.userId
    ? await readDismissedCandidates({
        userId: input.userId,
        seedMbid: input.seed.mbid,
      })
    : new Set<string>();

  const topScore = evidence.candidates[0]?.score ?? 0;

  // Rank is the provider's own position, computed before dismissals are
  // removed. Renumbering after a dismissal would silently rewrite what the
  // provider reported.
  const ranked = evidence.candidates.map((candidate, index) => ({
    candidate,
    rank: index + 1,
  }));

  const visible = ranked.filter(
    (entry) =>
      entry.candidate.mbid !== null && !dismissed.has(entry.candidate.mbid),
  );

  const page = visible.slice(input.offset, input.offset + DISCOVERY_PAGE_SIZE);

  const saved = input.userId
    ? await readSavedCandidates({
        userId: input.userId,
        mbids: page
          .map((entry) => entry.candidate.mbid)
          .filter((mbid): mbid is NonNullable<typeof mbid> => mbid !== null),
      })
    : new Set<string>();

  const candidates: DiscoveryCandidate[] = page.map((entry) => {
    const relativeScore =
      topScore > 0
        ? Math.round(
            Math.max(0, Math.min(1, entry.candidate.score / topScore)) * 100,
          )
        : 0;

    return {
      // Non-null by the filter above; ListenBrainz is MBID-native.
      mbid: entry.candidate.mbid!,
      name: entry.candidate.name,
      disambiguation: entry.candidate.disambiguation,
      type: entry.candidate.type,
      rank: entry.rank,
      strength:
        relativeScore >= 50
          ? "strong"
          : relativeScore >= 20
            ? "moderate"
            : "emerging",
      relativeScore,
      sourceUrl: entry.candidate.attribution.sourceUrl,
      saved: saved.has(entry.candidate.mbid!),
    };
  });

  return {
    ok: true,
    value: {
      seed: input.seed,
      candidates,
      reportedCount: evidence.candidates.length,
      dismissedCount: ranked.length - visible.length,
      hasMore: visible.length > input.offset + DISCOVERY_PAGE_SIZE,
      nextOffset: input.offset + DISCOVERY_PAGE_SIZE,
      attribution: evidence.attribution,
      algorithm: evidence.algorithm,
    },
  };
}

/** Why an explanation is the deterministic template rather than written prose. */
export type ExplanationStatus =
  | "ai"
  | "template-anonymous"
  | "template-unavailable"
  | "template-rejected"
  | "template-limit-reached"
  | "template-blocked";

export interface CandidateExplanation {
  readonly evidence: MatchEvidence;
  readonly explanation: DiscoveryExplanation;
  readonly status: ExplanationStatus;
}

function toStartingPoints(
  releases: readonly DiscographyRelease[],
): readonly StartingPoint[] {
  return releases.map((release) => ({
    releaseId: release.mbid,
    title: release.title,
    year: release.firstReleaseDate.value?.slice(0, 4) ?? null,
    primaryType: release.primaryType,
    sourceUrl: release.attribution.sourceUrl,
  }));
}

export async function explainCandidate(input: {
  readonly seed: SeedArtist;
  readonly candidateMbid: string;
  readonly listenerPreference: string | null;
  readonly userId: string | null;
}): Promise<ServiceResult<CandidateExplanation>> {
  let similarity;

  try {
    similarity = await getDiscoveryProvider().findSimilarArtists({
      mbid: input.seed.artist.mbid,
      limit: CANDIDATE_FETCH_LIMIT,
    });
  } catch (error) {
    return classifyProviderError(error);
  }

  const index = similarity.candidates.findIndex(
    (candidate) => candidate.mbid === input.candidateMbid,
  );
  const candidate = similarity.candidates[index];

  if (!candidate) {
    return failure(
      "not-found",
      "That candidate is no longer part of this result set.",
    );
  }

  // A metadata failure here is expected and survivable: the relationship is
  // still known, so the explanation is built from similarity data alone and
  // labelled as partial rather than failing the request.
  let candidateArtist: CanonicalArtist | null = null;
  let candidateReleases: readonly DiscographyRelease[] = [];

  try {
    const looked = await getMusicBrainzClient().lookupArtist(
      input.candidateMbid,
    );
    candidateArtist = looked.artist;
    candidateReleases = looked.releases;
  } catch (error) {
    if (!(error instanceof MusicBrainzError)) {
      throw error;
    }
    logger.warn({
      event: "discovery.candidate_enrichment_failed",
      kind: error.kind,
    });
  }

  const evidence = buildMatchEvidence({
    seed: input.seed.artist,
    candidate,
    candidateArtist,
    candidateReleases,
    rank: index + 1,
    totalCandidates: similarity.candidates.length,
    topScore: similarity.candidates[0]?.score ?? 0,
    similarityAttribution: similarity.attribution,
  });

  const template = buildTemplateExplanation({
    seedName: input.seed.artist.name,
    candidateName: candidate.name,
    evidence,
  });

  // Anonymous visitors get the deterministic explanation. AI usage is metered
  // per user, and an unauthenticated caller has no meter to charge.
  if (!input.userId) {
    return {
      ok: true,
      value: { evidence, explanation: template, status: "template-anonymous" },
    };
  }

  const allowedReleases = toStartingPoints(candidateReleases).slice(
    0,
    MAX_RELEASES_FOR_EXPLANATION,
  );

  const provider = getAiProvider();

  try {
    await claimAiUsage({
      userId: input.userId,
      provider: provider.name,
      operation: "explainArtistMatch",
    });

    const output = await provider.explainArtistMatch({
      seedArtistName: input.seed.artist.name,
      candidateArtistName: candidate.name,
      listenerPreference: input.listenerPreference,
      evidence: evidence.facts,
      candidateReleases: allowedReleases.map((release) => ({
        id: release.releaseId,
        title: release.title,
        primaryType: release.primaryType,
        year: release.year,
      })),
    });

    const verified = verifyExplanation({
      output,
      evidence,
      allowedReleases,
      model: provider.model,
    });

    if (!verified.ok) {
      logger.warn({
        event: "discovery.explanation_rejected",
        reason: verified.reason,
        provider: provider.name,
      });
      return {
        ok: true,
        value: {
          evidence,
          explanation: template,
          status: "template-rejected",
        },
      };
    }

    return {
      ok: true,
      value: { evidence, explanation: verified.explanation, status: "ai" },
    };
  } catch (error) {
    if (error instanceof AiUsageLimitError) {
      return {
        ok: true,
        value: {
          evidence,
          explanation: template,
          status: "template-limit-reached",
        },
      };
    }

    if (error instanceof AiBoundaryViolationError) {
      // Should be unreachable: nothing in this module handles Spotify data.
      // If it ever fires, it is a serious defect and must be loud.
      logger.error({
        event: "discovery.ai_boundary_violation",
        reason: error.reason,
        path: error.path,
      });
      return {
        ok: true,
        value: {
          evidence,
          explanation: template,
          status: "template-blocked",
        },
      };
    }

    if (error instanceof AiProviderError) {
      return {
        ok: true,
        value: {
          evidence,
          explanation: template,
          status: "template-unavailable",
        },
      };
    }

    throw error;
  }
}
