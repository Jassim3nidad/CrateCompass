import "server-only";

import { z } from "zod";

import { getServerEnvironment } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { paced } from "@/lib/providers/musicbrainz/pacer";
import {
  asMusicBrainzId,
  type ArtistSearchCandidate,
  type CanonicalArtist,
  type DiscographyRelease,
  type PartialDate,
  type ReleaseDatePrecision,
  type SourceAttribution,
} from "@/types/music";

/**
 * MusicBrainz web-service client.
 *
 * Two hard requirements from <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
 * are enforced here rather than left to callers: a meaningful User-Agent that
 * identifies the application and a way to contact its maintainer, and pacing at
 * one request per second. Requests without a real contact are throttled into
 * the anonymous bucket, so a missing contact is treated as a configuration
 * error rather than a soft default.
 */

const API_ORIGIN = "https://musicbrainz.org";
const WEB_ORIGIN = "https://musicbrainz.org";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

export type MusicBrainzFailureKind =
  | "not-configured"
  | "not-found"
  | "rate-limited"
  | "invalid-response"
  | "unavailable";

export class MusicBrainzError extends Error {
  readonly kind: MusicBrainzFailureKind;
  readonly status: number | undefined;

  constructor(
    kind: MusicBrainzFailureKind,
    message: string,
    status?: number | undefined,
  ) {
    super(message);
    this.name = "MusicBrainzError";
    this.kind = kind;
    this.status = status;
  }
}

export function buildUserAgent(): string {
  const environment = getServerEnvironment();

  if (!environment.MUSICBRAINZ_CONTACT) {
    throw new MusicBrainzError(
      "not-configured",
      "MUSICBRAINZ_CONTACT must be set so MusicBrainz can reach the application maintainer.",
    );
  }

  // Format required by MusicBrainz: Application/version ( contact ).
  return `${environment.MUSICBRAINZ_APP_NAME}/${environment.MUSICBRAINZ_APP_VERSION} ( ${environment.MUSICBRAINZ_CONTACT} )`;
}

function attribution(mbid: string): SourceAttribution {
  return {
    provenance: "musicbrainz",
    sourceUrl: `${WEB_ORIGIN}/artist/${mbid}`,
    retrievedAt: new Date().toISOString(),
  };
}

function releaseAttribution(mbid: string): SourceAttribution {
  return {
    provenance: "musicbrainz",
    sourceUrl: `${WEB_ORIGIN}/release-group/${mbid}`,
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * MusicBrainz dates are deliberately partial. "1997" means the year is known
 * and the month is not — padding it to 1997-01-01 would invent a fact.
 */
export function parsePartialDate(
  value: string | null | undefined,
): PartialDate {
  if (!value) {
    return { value: null, precision: "unknown" };
  }

  const precision: ReleaseDatePrecision =
    value.length === 4
      ? "year"
      : value.length === 7
        ? "month"
        : value.length === 10
          ? "day"
          : "unknown";

  return { value, precision: precision === "unknown" ? "unknown" : precision };
}

async function request(path: string, operation: string): Promise<unknown> {
  const userAgent = buildUserAgent();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await paced(() =>
        fetch(`${API_ORIGIN}${path}`, {
          headers: { "User-Agent": userAgent, Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
        }),
      );
    } catch {
      if (attempt < MAX_ATTEMPTS) continue;
      throw new MusicBrainzError(
        "unavailable",
        "MusicBrainz did not respond in time.",
      );
    }

    if (response.ok) {
      logger.info({
        event: "musicbrainz.request",
        operation,
        status: response.status,
        durationMs: Date.now() - startedAt,
        attempt,
      });

      return response.json();
    }

    if (response.status === 404) {
      throw new MusicBrainzError(
        "not-found",
        "MusicBrainz has no record with that identifier.",
        404,
      );
    }

    logger.warn({
      event: "musicbrainz.request_failed",
      operation,
      status: response.status,
      attempt,
    });

    // 503 is how MusicBrainz signals rate limiting, so it is retryable; the
    // pacer already spaces the retry by a full second.
    if (
      (response.status === 503 || response.status >= 500) &&
      attempt < MAX_ATTEMPTS
    ) {
      continue;
    }

    throw new MusicBrainzError(
      response.status === 503 ? "rate-limited" : "unavailable",
      "MusicBrainz refused the request.",
      response.status,
    );
  }

  throw new MusicBrainzError("unavailable", "MusicBrainz is unavailable.");
}

const artistSearchSchema = z.object({
  artists: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      "sort-name": z.string().optional(),
      disambiguation: z.string().optional(),
      type: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      score: z.number().optional(),
    }),
  ),
});

export async function searchArtists(
  query: string,
  options: { readonly limit?: number } = {},
): Promise<readonly ArtistSearchCandidate[]> {
  const parameters = new URLSearchParams({
    query,
    limit: String(Math.min(Math.max(options.limit ?? 10, 1), 25)),
    fmt: "json",
  });

  const payload = await request(`/ws/2/artist?${parameters}`, "artist.search");
  const parsed = artistSearchSchema.safeParse(payload);

  if (!parsed.success) {
    throw new MusicBrainzError(
      "invalid-response",
      "MusicBrainz returned an unexpected search response.",
    );
  }

  return parsed.data.artists.map((artist) => ({
    mbid: asMusicBrainzId(artist.id),
    name: artist.name,
    sortName: artist["sort-name"] ?? artist.name,
    disambiguation: artist.disambiguation || null,
    type: artist.type ?? null,
    country: artist.country ?? null,
    searchScore: artist.score ?? null,
    attribution: attribution(artist.id),
  }));
}

const artistLookupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  "sort-name": z.string().optional(),
  disambiguation: z.string().optional(),
  type: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  aliases: z
    .array(
      z.object({
        name: z.string().min(1),
        "sort-name": z.string().nullable().optional(),
        locale: z.string().nullable().optional(),
        primary: z.boolean().nullable().optional(),
      }),
    )
    .optional(),
  "release-groups": z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        "primary-type": z.string().nullable().optional(),
        "secondary-types": z.array(z.string()).optional(),
        "first-release-date": z.string().nullable().optional(),
        disambiguation: z.string().optional(),
      }),
    )
    .optional(),
});

export interface CanonicalArtistWithDiscography {
  readonly artist: CanonicalArtist;
  readonly releases: readonly DiscographyRelease[];
}

export async function lookupArtist(
  mbid: string,
): Promise<CanonicalArtistWithDiscography> {
  const parameters = new URLSearchParams({
    inc: "aliases release-groups",
    fmt: "json",
  });

  const payload = await request(
    `/ws/2/artist/${encodeURIComponent(mbid)}?${parameters}`,
    "artist.lookup",
  );
  const parsed = artistLookupSchema.safeParse(payload);

  if (!parsed.success) {
    throw new MusicBrainzError(
      "invalid-response",
      "MusicBrainz returned an unexpected artist response.",
    );
  }

  const data = parsed.data;

  return {
    artist: {
      mbid: asMusicBrainzId(data.id),
      name: data.name,
      sortName: data["sort-name"] ?? data.name,
      disambiguation: data.disambiguation || null,
      type: data.type ?? null,
      country: data.country ?? null,
      aliases: (data.aliases ?? []).map((alias) => ({
        name: alias.name,
        sortName: alias["sort-name"] ?? null,
        locale: alias.locale ?? null,
        primary: alias.primary === true,
      })),
      attribution: attribution(data.id),
    },
    releases: (data["release-groups"] ?? []).map((group) => ({
      mbid: asMusicBrainzId(group.id),
      title: group.title,
      primaryType: group["primary-type"] ?? null,
      secondaryTypes: group["secondary-types"] ?? [],
      firstReleaseDate: parsePartialDate(group["first-release-date"]),
      disambiguation: group.disambiguation || null,
      attribution: releaseAttribution(group.id),
    })),
  };
}
