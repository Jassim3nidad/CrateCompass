import "server-only";

import { getServerEnvironment } from "@/lib/env";
import { SpotifyProviderError } from "@/lib/providers/spotify/types";

/**
 * Minimum scope set (ADR 0002 and the compliance plan).
 *
 * Creating a private playlist and adding items to it both require only
 * `playlist-modify-private`. `GET /me` needs no scope for the fields we read —
 * every field gated behind `user-read-email` or `user-read-private` was
 * removed from the response in Spotify's February 2026 migration.
 *
 * Adding a scope here is a compliance decision, not a code change: it widens
 * what the user is asked to grant.
 */
export const SPOTIFY_SCOPES = ["playlist-modify-private"] as const;

export type SpotifyScope = (typeof SPOTIFY_SCOPES)[number];

export const SPOTIFY_ACCOUNTS_ORIGIN = "https://accounts.spotify.com";
export const SPOTIFY_API_ORIGIN = "https://api.spotify.com";

export interface SpotifyConfig {
  readonly clientId: string;
  readonly redirectUri: string;
}

export function isSpotifyConfigured(): boolean {
  const environment = getServerEnvironment();
  return Boolean(
    environment.SPOTIFY_CLIENT_ID &&
    environment.SPOTIFY_REDIRECT_URI &&
    environment.SPOTIFY_TOKEN_ENCRYPTION_KEY,
  );
}

export function getSpotifyConfig(): SpotifyConfig {
  const environment = getServerEnvironment();

  // The client secret is deliberately never read. ADR 0002 selects the PKCE
  // flow, under which Spotify's token endpoint takes `client_id` and
  // `code_verifier` and no client authentication header.
  if (!environment.SPOTIFY_CLIENT_ID || !environment.SPOTIFY_REDIRECT_URI) {
    throw new SpotifyProviderError(
      "not-configured",
      "Spotify is not configured for this deployment.",
    );
  }

  return {
    clientId: environment.SPOTIFY_CLIENT_ID,
    redirectUri: environment.SPOTIFY_REDIRECT_URI,
  };
}

export function hasRequiredScopes(granted: readonly string[]): boolean {
  return SPOTIFY_SCOPES.every((scope) => granted.includes(scope));
}
