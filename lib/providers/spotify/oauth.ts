import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import {
  getSpotifyConfig,
  SPOTIFY_ACCOUNTS_ORIGIN,
  SPOTIFY_SCOPES,
} from "@/lib/providers/spotify/config";
import {
  SpotifyProviderError,
  type SpotifyAccessGrant,
} from "@/lib/providers/spotify/types";

/**
 * Authorization Code with PKCE (ADR 0002).
 *
 * No client secret is read anywhere in this module. Spotify's PKCE token
 * endpoint takes `client_id` in the body and no client authentication header;
 * mixing in Basic auth is undocumented and deliberately not attempted.
 */

const TOKEN_ENDPOINT = `${SPOTIFY_ACCOUNTS_ORIGIN}/api/token`;
const AUTHORIZE_ENDPOINT = `${SPOTIFY_ACCOUNTS_ORIGIN}/authorize`;
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

export const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export interface OAuthState {
  readonly state: string;
  readonly digest: Buffer;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/** 64 random bytes encode to 86 base64url characters, inside RFC 7636's 43–128. */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(
    createHash("sha256").update(verifier, "ascii").digest(),
  );

  return { verifier, challenge };
}

/**
 * Only the digest is persisted. A database reader therefore cannot reconstruct
 * a state value that would pass the callback check.
 */
export function createOAuthState(): OAuthState {
  const state = base64Url(randomBytes(32));

  return { state, digest: digestState(state) };
}

export function digestState(state: string): Buffer {
  return createHash("sha256").update(state, "ascii").digest();
}

export function buildAuthorizeUrl(input: {
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const config = getSpotifyConfig();
  const url = new URL(AUTHORIZE_ENDPOINT);

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", input.codeChallenge);

  return url.toString();
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  // Spotify does not always rotate. When absent, the caller keeps the token it
  // already holds rather than treating this as a failure.
  refresh_token: z.string().min(1).optional(),
});

const tokenErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

async function requestToken(
  body: URLSearchParams,
  operation: string,
): Promise<SpotifyAccessGrant> {
  let response: Response;

  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new SpotifyProviderError(
      "unavailable",
      "Spotify did not respond in time.",
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = tokenErrorSchema.safeParse(payload);
    const reason = parsedError.success ? parsedError.data.error : "unknown";

    // Deliberately logs the reason code only. The body can echo the code, the
    // verifier, and the refresh token.
    logger.warn({
      event: "spotify.oauth.token_request_failed",
      operation,
      status: response.status,
      reason,
    });

    if (reason === "invalid_grant") {
      throw new SpotifyProviderError(
        "reauthorization-required",
        "The Spotify authorization is no longer valid and must be granted again.",
        { status: response.status },
      );
    }

    throw new SpotifyProviderError(
      response.status >= 500 ? "unavailable" : "invalid-request",
      "Spotify rejected the authorization request.",
      { status: response.status },
    );
  }

  const parsed = tokenResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new SpotifyProviderError(
      "invalid-response",
      "Spotify returned an unexpected token response.",
    );
  }

  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    scopes: parsed.data.scope
      ? parsed.data.scope.split(" ").filter(Boolean)
      : [],
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000),
  };
}

export async function exchangeAuthorizationCode(input: {
  readonly code: string;
  readonly codeVerifier: string;
}): Promise<SpotifyAccessGrant> {
  const config = getSpotifyConfig();

  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: input.codeVerifier,
    }),
    "authorization_code",
  );
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<SpotifyAccessGrant> {
  const config = getSpotifyConfig();

  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
    }),
    "refresh_token",
  );
}
