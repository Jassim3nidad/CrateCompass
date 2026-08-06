import "server-only";

import { z } from "zod";

import { getServerEnvironment } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { CACHE_TTL_MS, createTtlCache } from "@/lib/providers/cache";
import { paced } from "@/lib/providers/musicbrainz/pacer";
import {
  asMusicBrainzId,
  type ArtistSearchCandidate,
  type CanonicalArtist,
  type ReleaseTrack,
  type TaggedArtistCandidate,
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
const MAX_RETRY_WAIT_SECONDS = 10;

/** Shape of the live MusicBrainz error body, confirmed against 400 responses. */
const errorBodySchema = z.object({
  error: z.string(),
  help: z.string().optional(),
});

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;

  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** MusicBrainz returns genres and tags as objects with a `name` and a count. */
const namedTagSchema = z.array(z.object({ name: z.string() })).optional();

function toNames(
  entries: readonly { readonly name: string }[] | undefined,
): readonly string[] {
  return (entries ?? []).map((entry) => entry.name);
}

export type MusicBrainzFailureKind =
  | "not-configured"
  | "not-found"
  | "invalid-request"
  | "rate-limited"
  | "invalid-response"
  | "unavailable";

export class MusicBrainzError extends Error {
  readonly kind: MusicBrainzFailureKind;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: MusicBrainzFailureKind,
    message: string,
    options: {
      readonly status?: number | undefined;
      readonly retryAfterSeconds?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = "MusicBrainzError";
    this.kind = kind;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
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

    // Observed against the live service on 2026-08-04: MusicBrainz answers an
    // unknown *or* malformed MBID with 400 and {"error":"Invalid mbid."}, not
    // with 404. Classifying that as `unavailable` would have told users the
    // service was down when the artist simply does not exist.
    if (response.status === 400 || response.status === 404) {
      const body: unknown = await response.json().catch(() => null);
      const detail = errorBodySchema.safeParse(body);
      const isUnknownIdentifier =
        response.status === 404 ||
        (detail.success && /invalid mbid/i.test(detail.data.error));

      throw new MusicBrainzError(
        isUnknownIdentifier ? "not-found" : "invalid-request",
        isUnknownIdentifier
          ? "MusicBrainz has no record with that identifier."
          : "MusicBrainz rejected the request.",
        { status: response.status },
      );
    }

    const retryAfterSeconds = parseRetryAfter(response);

    logger.warn({
      event: "musicbrainz.request_failed",
      operation,
      status: response.status,
      attempt,
      retryAfterSeconds,
      // Present on live 503s and useful for tuning the pacer.
      rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
    });

    // 503 is how MusicBrainz signals rate limiting, and live responses carry
    // Retry-After. Honour it rather than relying on the pacer's fixed second.
    if (
      (response.status === 503 || response.status >= 500) &&
      attempt < MAX_ATTEMPTS
    ) {
      if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
        await sleep(Math.min(retryAfterSeconds, MAX_RETRY_WAIT_SECONDS) * 1000);
      }
      continue;
    }

    throw new MusicBrainzError(
      response.status === 503 ? "rate-limited" : "unavailable",
      "MusicBrainz refused the request.",
      { status: response.status, retryAfterSeconds },
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

const searchCache = createTtlCache<readonly ArtistSearchCandidate[]>({
  name: "musicbrainz.search",
  ttlMs: CACHE_TTL_MS.musicBrainzSearch,
});

const tagSearchCache = createTtlCache<readonly TaggedArtistCandidate[]>({
  name: "musicbrainz.tag_search",
  ttlMs: CACHE_TTL_MS.musicBrainzSearch,
});

/**
 * Caching track listings matters more than the other caches: building one
 * playlist needs a release lookup per artist at one request per second, so a
 * listener who edits and rebuilds would otherwise pay the full pacing cost
 * again.
 */
const releaseTrackCache = createTtlCache<readonly ReleaseTrack[]>({
  name: "musicbrainz.release_tracks",
  ttlMs: CACHE_TTL_MS.musicBrainzLookup,
});

/** Tag counts are the weighting signal that Lucene relevance does not provide. */
const taggedArtistSearchSchema = z.object({
  artists: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      "sort-name": z.string().optional(),
      disambiguation: z.string().optional(),
      type: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
      score: z.number().optional(),
      tags: z
        .array(z.object({ name: z.string(), count: z.number().optional() }))
        .optional(),
    }),
  ),
});

const releaseTracksSchema = z.object({
  releases: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      status: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      media: z
        .array(
          z.object({
            position: z.number().optional(),
            tracks: z
              .array(
                z.object({
                  position: z.number().optional(),
                  title: z.string().min(1),
                  recording: z.object({
                    id: z.string().min(1),
                    title: z.string().optional(),
                    length: z.number().nullable().optional(),
                  }),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const lookupCache = createTtlCache<CanonicalArtistWithDiscography>({
  name: "musicbrainz.lookup",
  ttlMs: CACHE_TTL_MS.musicBrainzLookup,
});

/** Test-only: drop cached provider reads between cases. */
export function clearMusicBrainzCachesForTesting(): void {
  searchCache.clear();
  lookupCache.clear();
  tagSearchCache.clear();
  releaseTrackCache.clear();
}

/**
 * The ordered tracks of a release group's earliest official release.
 *
 * One release per group, not all of them: a group can carry dozens of regional
 * pressings whose track lists are the same record, and fetching them all would
 * spend the pacing budget to learn nothing. Official status is preferred so a
 * promo or bootleg pressing does not stand in for the album.
 */
export async function listReleaseGroupTracks(
  releaseGroupMbid: string,
): Promise<readonly ReleaseTrack[]> {
  return releaseTrackCache.read(releaseGroupMbid, () =>
    listReleaseGroupTracksUncached(releaseGroupMbid),
  );
}

async function listReleaseGroupTracksUncached(
  releaseGroupMbid: string,
): Promise<readonly ReleaseTrack[]> {
  const parameters = new URLSearchParams({
    "release-group": releaseGroupMbid,
    inc: "recordings",
    // A handful, then pick: asking for one risks getting a promo pressing.
    limit: "5",
    fmt: "json",
  });

  const payload = await request(
    `/ws/2/release?${parameters}`,
    "release.tracks",
  );
  const parsed = releaseTracksSchema.safeParse(payload);

  if (!parsed.success) {
    throw new MusicBrainzError(
      "invalid-response",
      "MusicBrainz returned an unexpected release response.",
    );
  }

  const withTracks = parsed.data.releases.filter((release) =>
    (release.media ?? []).some((medium) => (medium.tracks ?? []).length > 0),
  );

  if (withTracks.length === 0) {
    return [];
  }

  const official = withTracks.filter(
    (release) => release.status === "Official",
  );
  const pool = official.length > 0 ? official : withTracks;
  const selected = pool.reduce((earliest, release) =>
    (release.date ?? "9999") < (earliest.date ?? "9999") ? release : earliest,
  );

  return (selected.media ?? []).flatMap((medium) =>
    (medium.tracks ?? []).map((track) => ({
      recordingMbid: asMusicBrainzId(track.recording.id),
      title: track.recording.title ?? track.title,
      position: track.position ?? 0,
      mediumPosition: medium.position ?? 1,
      lengthMs: track.recording.length ?? null,
      releaseTitle: selected.title,
      releaseGroupMbid: asMusicBrainzId(releaseGroupMbid),
    })),
  );
}

export async function searchArtists(
  query: string,
  options: { readonly limit?: number } = {},
): Promise<readonly ArtistSearchCandidate[]> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);

  return searchCache.read(`${limit}:${query}`, () =>
    searchArtistsUncached(query, limit),
  );
}

async function searchArtistsUncached(
  query: string,
  limit: number,
): Promise<readonly ArtistSearchCandidate[]> {
  const parameters = new URLSearchParams({
    query,
    limit: String(limit),
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

/**
 * Artist search constrained to a tag, with optional country and type filters.
 *
 * Lucene relevance, not popularity, decides the order — probing `tag:"trip hop"`
 * alone put Madonna in the top three. Adding a country filter changed the same
 * probe to Fatboy Slim, Faithless and The Chemical Brothers, so the filters are
 * a quality mechanism rather than a convenience. Ranking is still corrected
 * afterwards (`lib/mood/seed-ranking.ts`) and confirmed by a person.
 */
export async function searchArtistsByTag(input: {
  readonly tag: string;
  readonly country?: string | undefined;
  readonly type?: string | undefined;
  readonly limit?: number | undefined;
}): Promise<readonly TaggedArtistCandidate[]> {
  const tag = input.tag.trim();

  if (tag.length === 0) {
    return [];
  }

  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const clauses = [`tag:"${tag.replace(/"/g, "")}"`];

  if (input.country) clauses.push(`country:${input.country}`);
  if (input.type) clauses.push(`type:${input.type}`);

  const key = `${limit}:${clauses.join(" AND ")}`;

  return tagSearchCache.read(key, () =>
    searchArtistsByTagUncached(clauses.join(" AND "), limit),
  );
}

async function searchArtistsByTagUncached(
  query: string,
  limit: number,
): Promise<readonly TaggedArtistCandidate[]> {
  const parameters = new URLSearchParams({
    query,
    limit: String(limit),
    fmt: "json",
  });

  const payload = await request(
    `/ws/2/artist?${parameters}`,
    "artist.tag_search",
  );
  const parsed = taggedArtistSearchSchema.safeParse(payload);

  if (!parsed.success) {
    throw new MusicBrainzError(
      "invalid-response",
      "MusicBrainz returned an unexpected tag-search response.",
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
    // Present on most but not all search hits, which is why ranking must
    // tolerate an empty list rather than assuming a tag is absent.
    tags: (artist.tags ?? []).map((entry) => ({
      name: entry.name,
      count: entry.count ?? 0,
    })),
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
  genres: namedTagSchema,
  tags: namedTagSchema,
  "release-groups": z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        "primary-type": z.string().nullable().optional(),
        "secondary-types": z.array(z.string()).optional(),
        "first-release-date": z.string().nullable().optional(),
        disambiguation: z.string().optional(),
        genres: namedTagSchema,
        tags: namedTagSchema,
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
  return lookupCache.read(mbid, () => lookupArtistUncached(mbid));
}

async function lookupArtistUncached(
  mbid: string,
): Promise<CanonicalArtistWithDiscography> {
  const parameters = new URLSearchParams({
    // Genres and tags are requested because they are the only tag-shaped data
    // available after the move off Last.fm. See the Phase 7 scope note.
    inc: "aliases release-groups genres tags",
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
      genres: toNames(data.genres),
      tags: toNames(data.tags),
      attribution: attribution(data.id),
    },
    releases: (data["release-groups"] ?? []).map((group) => ({
      mbid: asMusicBrainzId(group.id),
      title: group.title,
      primaryType: group["primary-type"] ?? null,
      secondaryTypes: group["secondary-types"] ?? [],
      firstReleaseDate: parsePartialDate(group["first-release-date"]),
      disambiguation: group.disambiguation || null,
      genres: toNames(group.genres),
      tags: toNames(group.tags),
      attribution: releaseAttribution(group.id),
    })),
  };
}
