import "server-only";

import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { SPOTIFY_API_ORIGIN } from "@/lib/providers/spotify/config";
import {
  asSpotifyAccountId,
  asSpotifyResourceId,
  asSpotifyUri,
  SpotifyProviderError,
  type SpotifyProfile,
  type SpotifyResourceId,
  type SpotifyUri,
} from "@/lib/providers/spotify/types";

/**
 * Server-only Spotify Web API client.
 *
 * Callers describe an *operation*, never a path. That is the endpoint
 * allowlist: there is no code path that builds an arbitrary Spotify URL, so
 * reaching a removed or prohibited endpoint requires editing this file, which
 * is a reviewable compliance change rather than an accident.
 *
 * The four permitted operations are the ones that survived Spotify's February
 * 2026 migration and are named in the compliance plan.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 20_000;

/** Spotify capped search at 10 results per request in February 2026. */
export const SEARCH_RESULT_LIMIT = 10;
/** Add Items to Playlist accepts at most 100 URIs. */
export const PLAYLIST_ITEM_BATCH_LIMIT = 100;

export type SpotifyOperation =
  | { readonly kind: "current-user" }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly types: readonly ("artist" | "track")[];
      readonly limit: number;
    }
  | {
      readonly kind: "create-playlist";
      readonly name: string;
      readonly description: string | null;
      /**
       * Explicit rather than defaulted. Spotify's own default for this field
       * is `true`, so an omitted value would publish a playlist the listener
       * did not ask to publish.
       */
      readonly isPublic: boolean;
    }
  | {
      readonly kind: "add-playlist-items";
      readonly playlistId: SpotifyResourceId;
      readonly uris: readonly SpotifyUri[];
    };

interface ResolvedRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body: unknown;
}

function resolveRequest(operation: SpotifyOperation): ResolvedRequest {
  switch (operation.kind) {
    case "current-user":
      return { method: "GET", path: "/v1/me", body: undefined };

    case "search": {
      if (operation.limit < 1 || operation.limit > SEARCH_RESULT_LIMIT) {
        throw new SpotifyProviderError(
          "invalid-request",
          `Spotify search accepts between 1 and ${SEARCH_RESULT_LIMIT} results per request.`,
        );
      }

      const query = new URLSearchParams({
        q: operation.query,
        type: operation.types.join(","),
        limit: String(operation.limit),
      });

      return { method: "GET", path: `/v1/search?${query}`, body: undefined };
    }

    case "create-playlist":
      return {
        method: "POST",
        path: "/v1/me/playlists",
        body: {
          name: operation.name,
          // Carries the listener's choice. Both scopes are granted, so the
          // value here — not the scope — is what decides visibility.
          public: operation.isPublic,
          collaborative: false,
          ...(operation.description
            ? { description: operation.description }
            : {}),
        },
      };

    case "add-playlist-items": {
      if (
        operation.uris.length === 0 ||
        operation.uris.length > PLAYLIST_ITEM_BATCH_LIMIT
      ) {
        throw new SpotifyProviderError(
          "invalid-request",
          `Spotify accepts between 1 and ${PLAYLIST_ITEM_BATCH_LIMIT} items per request.`,
        );
      }

      return {
        method: "POST",
        // The `/tracks` path is deprecated; `/items` is current.
        path: `/v1/playlists/${encodeURIComponent(operation.playlistId)}/items`,
        body: { uris: [...operation.uris] },
      };
    }
  }
}

const spotifyErrorSchema = z.object({
  error: z.object({
    status: z.number().optional(),
    message: z.string().optional(),
    reason: z.string().optional(),
  }),
});

function parseRetryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) {
    return undefined;
  }

  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function classify(
  status: number,
  reason: string | undefined,
  retryAfterSeconds: number | undefined,
): SpotifyProviderError {
  if (status === 401) {
    return new SpotifyProviderError(
      "unauthorized",
      "The Spotify access token was rejected.",
      { status },
    );
  }

  if (status === 403) {
    // In Development Mode a 403 usually means the account is not on the
    // allowlist rather than that a scope is missing.
    return new SpotifyProviderError(
      reason === "insufficient_scope"
        ? "insufficient-scope"
        : "not-allowlisted",
      "Spotify refused the request for this account.",
      { status },
    );
  }

  if (status === 429) {
    return new SpotifyProviderError(
      reason === "QUOTA_EXCEEDED" ? "quota-exceeded" : "rate-limited",
      reason === "QUOTA_EXCEEDED"
        ? "The Spotify quota for this application is exhausted."
        : "Spotify is rate limiting requests.",
      { status, retryAfterSeconds },
    );
  }

  if (status >= 500) {
    return new SpotifyProviderError("unavailable", "Spotify is unavailable.", {
      status,
    });
  }

  return new SpotifyProviderError(
    "invalid-request",
    "Spotify rejected the request.",
    { status },
  );
}

function isRetryable(error: SpotifyProviderError): boolean {
  return (
    error.kind === "unavailable" ||
    error.kind === "rate-limited" ||
    error.kind === "quota-exceeded"
  );
}

function backoffDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS);
  }

  const base = Math.min(500 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  return base + Math.floor(Math.random() * 250);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callSpotify(
  operation: SpotifyOperation,
  accessToken: string,
): Promise<unknown> {
  const request = resolveRequest(operation);
  let lastError: SpotifyProviderError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetch(`${SPOTIFY_API_ORIGIN}${request.path}`, {
        method: request.method,
        headers: {
          // Never logged: the logger redacts `authorization`, and no code path
          // passes these headers to a log call.
          Authorization: `Bearer ${accessToken}`,
          ...(request.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      lastError = new SpotifyProviderError(
        "unavailable",
        "Spotify did not respond in time.",
      );

      if (attempt < MAX_ATTEMPTS) {
        await wait(backoffDelayMs(attempt));
        continue;
      }

      throw lastError;
    }

    if (response.ok) {
      logger.info({
        event: "spotify.request",
        operation: operation.kind,
        status: response.status,
        durationMs: Date.now() - startedAt,
        attempt,
      });

      return response.status === 204 ? null : await response.json();
    }

    const payload: unknown = await response.json().catch(() => null);
    const parsed = spotifyErrorSchema.safeParse(payload);
    const reason = parsed.success ? parsed.data.error.reason : undefined;
    const retryAfterSeconds = parseRetryAfter(response);

    lastError = classify(response.status, reason, retryAfterSeconds);

    logger.warn({
      event: "spotify.request_failed",
      operation: operation.kind,
      status: response.status,
      kind: lastError.kind,
      reason,
      retryAfterSeconds,
      attempt,
    });

    if (attempt < MAX_ATTEMPTS && isRetryable(lastError)) {
      await wait(backoffDelayMs(attempt, retryAfterSeconds));
      continue;
    }

    throw lastError;
  }

  throw (
    lastError ??
    new SpotifyProviderError("unavailable", "Spotify is unavailable.")
  );
}

/**
 * `account_id` is the immutable linking identifier. Spotify's reference
 * explicitly advises against `id` for account linking, and the fields behind
 * `user-read-email` / `user-read-private` were removed in February 2026, so
 * they are absent by design rather than optional.
 */
const currentUserSchema = z.object({
  account_id: z.string().min(1),
  display_name: z.string().nullable().optional(),
  external_urls: z.object({ spotify: z.string().url() }).partial().optional(),
});

export async function getCurrentUser(
  accessToken: string,
): Promise<SpotifyProfile> {
  const payload = await callSpotify({ kind: "current-user" }, accessToken);
  const parsed = currentUserSchema.safeParse(payload);

  if (!parsed.success) {
    throw new SpotifyProviderError(
      "invalid-response",
      "Spotify did not return an account identifier for the current user.",
    );
  }

  return {
    accountId: asSpotifyAccountId(parsed.data.account_id),
    displayName: parsed.data.display_name ?? null,
    profileUrl: parsed.data.external_urls?.spotify ?? null,
  };
}

const searchSchema = z.object({
  artists: z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          uri: z.string(),
          name: z.string(),
        }),
      ),
    })
    .optional(),
  tracks: z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          uri: z.string(),
          name: z.string(),
        }),
      ),
    })
    .optional(),
});

export interface SpotifySearchMatch {
  readonly id: SpotifyResourceId;
  readonly uri: SpotifyUri;
  readonly name: string;
}

export interface SpotifySearchResult {
  readonly artists: readonly SpotifySearchMatch[];
  readonly tracks: readonly SpotifySearchMatch[];
}

export async function search(
  accessToken: string,
  input: {
    readonly query: string;
    readonly types: readonly ("artist" | "track")[];
    readonly limit?: number;
  },
): Promise<SpotifySearchResult> {
  const payload = await callSpotify(
    {
      kind: "search",
      query: input.query,
      types: input.types,
      limit: input.limit ?? SEARCH_RESULT_LIMIT,
    },
    accessToken,
  );

  const parsed = searchSchema.safeParse(payload);

  if (!parsed.success) {
    throw new SpotifyProviderError(
      "invalid-response",
      "Spotify returned an unexpected search response.",
    );
  }

  const toMatches = (
    items: readonly { id: string; uri: string; name: string }[] | undefined,
  ): readonly SpotifySearchMatch[] =>
    (items ?? []).map((item) => ({
      id: asSpotifyResourceId(item.id),
      uri: asSpotifyUri(item.uri),
      name: item.name,
    }));

  return {
    artists: toMatches(parsed.data.artists?.items),
    tracks: toMatches(parsed.data.tracks?.items),
  };
}

const createdPlaylistSchema = z.object({
  id: z.string().min(1),
  uri: z.string().min(1),
});

export async function createPlaylist(
  accessToken: string,
  input: {
    readonly name: string;
    readonly description?: string | null;
    /** Omitted means private. Publishing is always an explicit choice. */
    readonly isPublic?: boolean;
  },
): Promise<{ readonly id: SpotifyResourceId; readonly uri: SpotifyUri }> {
  const payload = await callSpotify(
    {
      kind: "create-playlist",
      name: input.name,
      description: input.description ?? null,
      isPublic: input.isPublic ?? false,
    },
    accessToken,
  );

  const parsed = createdPlaylistSchema.safeParse(payload);

  if (!parsed.success) {
    throw new SpotifyProviderError(
      "invalid-response",
      "Spotify returned an unexpected playlist response.",
    );
  }

  return {
    id: asSpotifyResourceId(parsed.data.id),
    uri: asSpotifyUri(parsed.data.uri),
  };
}

const snapshotSchema = z.object({ snapshot_id: z.string().min(1) });

export async function addPlaylistItems(
  accessToken: string,
  input: {
    readonly playlistId: SpotifyResourceId;
    readonly uris: readonly SpotifyUri[];
  },
): Promise<string> {
  const payload = await callSpotify(
    {
      kind: "add-playlist-items",
      playlistId: input.playlistId,
      uris: input.uris,
    },
    accessToken,
  );

  const parsed = snapshotSchema.safeParse(payload);

  if (!parsed.success) {
    throw new SpotifyProviderError(
      "invalid-response",
      "Spotify returned an unexpected playlist-items response.",
    );
  }

  return parsed.data.snapshot_id;
}

/** Exposed for the endpoint-allowlist contract test. */
export const __testing = { resolveRequest, classify, backoffDelayMs };
