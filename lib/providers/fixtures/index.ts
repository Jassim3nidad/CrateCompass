import "server-only";

import { getServerEnvironment } from "@/lib/env";
import { MusicBrainzError } from "@/lib/providers/musicbrainz/client";
import type { MusicBrainzPort } from "@/lib/providers/musicbrainz/port";
import {
  DiscoveryProviderError,
  UnsupportedDiscoveryOperationError,
  type DiscoveryProvider,
  type SimilarArtistsInput,
} from "@/lib/providers/discovery/port";
import {
  fixtureLookup,
  fixtureSearch,
  fixtureSimilarArtists,
  FIXTURE_SEEDS,
  UNRESOLVABLE_CANDIDATE_MBID,
} from "@/lib/providers/fixtures/catalog";
import {
  asMusicBrainzId,
  type ArtistCandidate,
  type SimilarityEvidence,
} from "@/types/music";

/**
 * Fixture provider implementations for the end-to-end suite.
 *
 * Playwright can only intercept requests the *browser* makes, and every
 * provider call in this application is made server-side. Without a seam here
 * the end-to-end journey could not be tested against anything but live
 * providers, which the compliance plan forbids.
 *
 * The seam is deliberately narrow and loud:
 *
 * - it activates only when `APP_ENV=test` **and** `PROVIDER_FIXTURES=1`;
 * - the environment schema refuses to validate that flag outside a test
 *   environment, so a production process carrying it will not start;
 * - the data it returns is invented, so a fixture result cannot be mistaken
 *   for a provider record.
 */

export function areProviderFixturesEnabled(): boolean {
  return getServerEnvironment().PROVIDER_FIXTURES === "1";
}

const FIXTURE_ALGORITHM = "fixture_similarity_v1";

export function createFixtureMusicBrainzPort(): MusicBrainzPort {
  return {
    async searchArtists(query, options) {
      return fixtureSearch(query, options?.limit ?? 10);
    },

    async lookupArtist(mbid) {
      // One candidate always fails so the partial-result state — relationship
      // known, metadata unavailable — is reachable from a test.
      if (mbid === UNRESOLVABLE_CANDIDATE_MBID) {
        throw new MusicBrainzError(
          "unavailable",
          "MusicBrainz did not respond in time.",
        );
      }

      const found = fixtureLookup(mbid);

      if (!found) {
        throw new MusicBrainzError(
          "not-found",
          "MusicBrainz has no record with that identifier.",
        );
      }

      return found;
    },
  };
}

export function createFixtureDiscoveryProvider(): DiscoveryProvider {
  return {
    name: "listenbrainz",

    async findSimilarArtists(
      input: SimilarArtistsInput,
    ): Promise<SimilarityEvidence> {
      if (input.mbid === FIXTURE_SEEDS.providerDown) {
        throw new DiscoveryProviderError(
          "unavailable",
          "The discovery provider is unavailable.",
        );
      }

      const retrievedAt = new Date().toISOString();
      const candidates: ArtistCandidate[] = fixtureSimilarArtists(
        input.mbid,
      ).map((row) => ({
        mbid: asMusicBrainzId(row.mbid),
        name: row.name,
        disambiguation: row.disambiguation,
        type: row.type,
        score: row.score,
        attribution: {
          provenance: "listenbrainz" as const,
          sourceUrl: `https://listenbrainz.org/artist/${row.mbid}`,
          retrievedAt,
        },
      }));

      return {
        referenceMbid: input.mbid,
        candidates: candidates.slice(0, input.limit ?? 25),
        algorithm: FIXTURE_ALGORITHM,
        attribution: {
          provenance: "listenbrainz",
          sourceUrl: `https://listenbrainz.org/artist/${input.mbid}`,
          retrievedAt,
        },
      };
    },

    findArtistsByTags(): Promise<never> {
      return Promise.reject(
        new UnsupportedDiscoveryOperationError(
          "findArtistsByTags",
          "listenbrainz",
        ),
      );
    },

    findTracksByTags(): Promise<never> {
      return Promise.reject(
        new UnsupportedDiscoveryOperationError(
          "findTracksByTags",
          "listenbrainz",
        ),
      );
    },
  };
}
