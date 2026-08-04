import "server-only";

import { z } from "zod";

import { getServerEnvironment } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import {
  DiscoveryProviderError,
  type DiscoveryProvider,
  type SimilarArtistsInput,
} from "@/lib/providers/discovery/port";
import {
  asMusicBrainzId,
  type ArtistCandidate,
  type SimilarityEvidence,
} from "@/types/music";

/**
 * ListenBrainz similar-artists adapter.
 *
 * Similar artists come from the Labs dataset hoster rather than the core
 * ListenBrainz API. That host offers a weaker stability guarantee and takes an
 * opaque algorithm tuning string, so the algorithm is environment-configurable
 * and the response is strictly validated: an unrecognised shape degrades to
 * "no similarity data" rather than propagating malformed evidence into the
 * product. See ADR 0003.
 *
 * Results are MBID-native, which is why downstream matching against the
 * canonical artist is an identifier comparison rather than a fuzzy name join.
 */

const LABS_ORIGIN = "https://labs.api.listenbrainz.org";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 25;

export const DEFAULT_SIMILARITY_ALGORITHM =
  "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";

const similarArtistSchema = z.object({
  artist_mbid: z.string().min(1),
  name: z.string().min(1),
  comment: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  score: z.number(),
  reference_mbid: z.string().nullable().optional(),
});

// The endpoint returns a bare array. Some dataset-hoster endpoints wrap results
// in a leading metadata element, so both shapes are accepted and anything else
// is rejected.
const similarArtistsResponseSchema = z.union([
  z.array(similarArtistSchema),
  z.array(z.unknown()),
]);

function resolveAlgorithm(): string {
  const configured = process.env.LISTENBRAINZ_SIMILARITY_ALGORITHM;
  return configured && configured.length > 0
    ? configured
    : DEFAULT_SIMILARITY_ALGORITHM;
}

function parseRetryAfter(response: Response): number | undefined {
  const resetIn = response.headers.get("x-ratelimit-reset-in");
  if (!resetIn) return undefined;

  const seconds = Number.parseInt(resetIn, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function createListenBrainzProvider(): DiscoveryProvider {
  return {
    name: "listenbrainz",

    async findSimilarArtists(
      input: SimilarArtistsInput,
    ): Promise<SimilarityEvidence> {
      const algorithm = resolveAlgorithm();
      const parameters = new URLSearchParams({
        artist_mbids: input.mbid,
        algorithm,
      });

      const environment = getServerEnvironment();
      const headers: Record<string, string> = { Accept: "application/json" };

      // A token is optional for reads and may raise the rate limit.
      if (environment.LISTENBRAINZ_USER_TOKEN) {
        headers.Authorization = `Token ${environment.LISTENBRAINZ_USER_TOKEN}`;
      }

      const startedAt = Date.now();
      let response: Response;

      try {
        response = await fetch(
          `${LABS_ORIGIN}/similar-artists/json?${parameters}`,
          {
            headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
          },
        );
      } catch {
        throw new DiscoveryProviderError(
          "unavailable",
          "The discovery provider did not respond in time.",
        );
      }

      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfter(response);
        logger.warn({
          event: "listenbrainz.rate_limited",
          retryAfterSeconds,
        });
        throw new DiscoveryProviderError(
          "rate-limited",
          "The discovery provider is rate limiting requests.",
          retryAfterSeconds,
        );
      }

      if (!response.ok) {
        logger.warn({
          event: "listenbrainz.request_failed",
          status: response.status,
        });
        throw new DiscoveryProviderError(
          "unavailable",
          "The discovery provider refused the request.",
        );
      }

      const payload: unknown = await response.json().catch(() => null);
      const parsed = similarArtistsResponseSchema.safeParse(payload);

      if (!parsed.success) {
        throw new DiscoveryProviderError(
          "invalid-response",
          "The discovery provider returned an unexpected response.",
        );
      }

      const retrievedAt = new Date().toISOString();
      const candidates: ArtistCandidate[] = [];

      for (const entry of parsed.data) {
        const candidate = similarArtistSchema.safeParse(entry);
        // Entries that do not match are skipped rather than failing the whole
        // result: a metadata header element must not lose the real candidates.
        if (!candidate.success) continue;

        candidates.push({
          mbid: asMusicBrainzId(candidate.data.artist_mbid),
          name: candidate.data.name,
          disambiguation: candidate.data.comment || null,
          type: candidate.data.type ?? null,
          score: candidate.data.score,
          attribution: {
            provenance: "listenbrainz",
            sourceUrl: `https://listenbrainz.org/artist/${candidate.data.artist_mbid}`,
            retrievedAt,
          },
        });
      }

      candidates.sort((first, second) => second.score - first.score);

      logger.info({
        event: "listenbrainz.similar_artists",
        durationMs: Date.now() - startedAt,
        candidateCount: candidates.length,
        rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
      });

      return {
        referenceMbid: input.mbid,
        candidates: candidates.slice(0, input.limit ?? DEFAULT_LIMIT),
        algorithm,
        attribution: {
          provenance: "listenbrainz",
          sourceUrl: `https://listenbrainz.org/artist/${input.mbid}`,
          retrievedAt,
        },
      };
    },
  };
}

export function getDiscoveryProvider(): DiscoveryProvider {
  const environment = getServerEnvironment();

  if (environment.DISCOVERY_PROVIDER !== "listenbrainz") {
    // ADR 0003 selected ListenBrainz. Last.fm is intentionally unimplemented:
    // its terms prohibit sub-licensing its data to a third party, which makes
    // sending evidence to an AI provider legally ambiguous.
    throw new DiscoveryProviderError(
      "not-configured",
      `Discovery provider "${environment.DISCOVERY_PROVIDER}" is not implemented. Set DISCOVERY_PROVIDER=listenbrainz.`,
    );
  }

  return createListenBrainzProvider();
}
