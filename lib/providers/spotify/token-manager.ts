import "server-only";

import { logger } from "@/lib/observability/logger";
import { refreshAccessToken } from "@/lib/providers/spotify/oauth";
import {
  markConnectionExpired,
  readCredentials,
  rotateCredentials,
} from "@/lib/providers/spotify/repository";
import { hasRequiredScopes } from "@/lib/providers/spotify/config";
import { SpotifyProviderError } from "@/lib/providers/spotify/types";
import {
  getCurrentEncryptionKeyVersion,
  resolveEncryptionKey,
} from "@/lib/security/encryption-keys";
import {
  openCredential,
  sealCredential,
  TokenDecryptionError,
} from "@/lib/security/token-encryption";

/**
 * Access-token lifecycle.
 *
 * Three distinct failure modes reach the user as different states:
 *   - the access token expired — refreshed silently here;
 *   - the refresh token was revoked or aged out past its six-month lifetime —
 *     surfaced as `reauthorization-required` so the UI asks for a reconnect;
 *   - the connection was disconnected — no credential row exists, so no
 *     refresh is even attempted.
 */

const REFRESH_SKEW_MS = 60_000;

export async function getAccessToken(userId: string): Promise<string> {
  const stored = await readCredentials(userId);

  if (!stored) {
    throw new SpotifyProviderError(
      "reauthorization-required",
      "No Spotify account is connected.",
    );
  }

  if (!hasRequiredScopes(stored.scopes)) {
    throw new SpotifyProviderError(
      "insufficient-scope",
      "The Spotify connection is missing a required permission.",
    );
  }

  const key = resolveEncryptionKey(stored.accessToken.keyVersion);
  const binding = {
    subjectId: stored.connectionId,
    userId,
    keyVersion: stored.accessToken.keyVersion,
  } as const;

  if (stored.tokenExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
    try {
      return openCredential(
        stored.accessToken,
        { ...binding, purpose: "spotify.access_token" },
        key,
      );
    } catch (error) {
      if (!(error instanceof TokenDecryptionError)) {
        throw error;
      }

      // A credential we cannot open is not recoverable by retrying.
      logger.error({
        event: "spotify.token.decryption_failed",
        purpose: "access_token",
      });
      await markConnectionExpired(userId);
      throw new SpotifyProviderError(
        "reauthorization-required",
        "The stored Spotify credential could not be read. Reconnect the account.",
      );
    }
  }

  let refreshToken: string;

  try {
    refreshToken = openCredential(
      stored.refreshToken,
      { ...binding, purpose: "spotify.refresh_token" },
      key,
    );
  } catch (error) {
    if (!(error instanceof TokenDecryptionError)) {
      throw error;
    }

    logger.error({
      event: "spotify.token.decryption_failed",
      purpose: "refresh_token",
    });
    await markConnectionExpired(userId);
    throw new SpotifyProviderError(
      "reauthorization-required",
      "The stored Spotify credential could not be read. Reconnect the account.",
    );
  }

  let grant;

  try {
    grant = await refreshAccessToken(refreshToken);
  } catch (error) {
    if (
      error instanceof SpotifyProviderError &&
      error.kind === "reauthorization-required"
    ) {
      await markConnectionExpired(userId);
    }

    throw error;
  }

  const keyVersion = getCurrentEncryptionKeyVersion();
  const rotationKey = resolveEncryptionKey(keyVersion);
  const rotationBinding = {
    subjectId: stored.connectionId,
    userId,
    keyVersion,
  } as const;

  const applied = await rotateCredentials({
    connectionId: stored.connectionId,
    userId,
    expectedTokenExpiresAt: stored.tokenExpiresAt,
    accessToken: sealCredential(
      grant.accessToken,
      { ...rotationBinding, purpose: "spotify.access_token" },
      rotationKey,
    ),
    // Spotify does not always rotate the refresh token. When it does not, the
    // existing one is re-sealed rather than dropped.
    refreshToken: sealCredential(
      grant.refreshToken ?? refreshToken,
      { ...rotationBinding, purpose: "spotify.refresh_token" },
      rotationKey,
    ),
    tokenExpiresAt: grant.expiresAt,
  });

  if (!applied) {
    // Another instance refreshed first. Its token is at least as fresh as
    // ours, so re-read rather than overwrite it.
    logger.info({ event: "spotify.token.refresh_raced" });
    return getAccessToken(userId);
  }

  logger.info({
    event: "spotify.token.refreshed",
    rotated: Boolean(grant.refreshToken),
  });

  return grant.accessToken;
}
