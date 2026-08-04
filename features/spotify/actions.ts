"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logger } from "@/lib/observability/logger";
import { isSpotifyConfigured } from "@/lib/providers/spotify/config";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  OAUTH_TRANSACTION_TTL_MS,
} from "@/lib/providers/spotify/oauth";
import {
  beginOAuthTransaction,
  disconnect,
} from "@/lib/providers/spotify/repository";
import { getSafeReturnPath } from "@/lib/security/safe-redirect";
import {
  getCurrentEncryptionKeyVersion,
  resolveEncryptionKey,
} from "@/lib/security/encryption-keys";
import { sealCredential } from "@/lib/security/token-encryption";
import { getAuthenticatedUser } from "@/lib/supabase/auth";
import type { SpotifyActionState } from "@/features/spotify/state";

const CONNECTIONS_PATH = "/settings/connections";

// Neither action reads the previous state or any form field: connecting and
// disconnecting are whole-account operations with no inputs. They stay
// compatible with `useActionState`, which simply ignores the unused arguments.
export async function connectSpotify(): Promise<SpotifyActionState> {
  const { user } = await getAuthenticatedUser();

  if (!isSpotifyConfigured()) {
    return {
      status: "error",
      message:
        "Spotify is not configured for this deployment. No connection can be started.",
    };
  }

  const { verifier, challenge } = createPkcePair();
  const { state, digest } = createOAuthState();
  const transactionId = randomUUID();
  const keyVersion = getCurrentEncryptionKeyVersion();

  try {
    await beginOAuthTransaction({
      transactionId,
      userId: user.id,
      stateDigest: digest,
      // Bound to this transaction and this user, so a verifier lifted from the
      // database cannot be replayed into a different authorization attempt.
      codeVerifier: sealCredential(
        verifier,
        {
          purpose: "spotify.code_verifier",
          subjectId: transactionId,
          userId: user.id,
          keyVersion,
        },
        resolveEncryptionKey(keyVersion),
      ),
      redirectPath: CONNECTIONS_PATH,
      expiresAt: new Date(Date.now() + OAUTH_TRANSACTION_TTL_MS),
    });
  } catch {
    logger.error({ event: "spotify.connect.transaction_failed" });
    return {
      status: "error",
      message:
        "The Spotify connection could not be started. Try again shortly.",
    };
  }

  redirect(buildAuthorizeUrl({ state, codeChallenge: challenge }));
}

export async function disconnectSpotify(): Promise<SpotifyActionState> {
  const { user } = await getAuthenticatedUser();

  try {
    // Destroys the stored ciphertext first, so any refresh racing this call
    // finds no credential rather than one it is still permitted to use.
    await disconnect(user.id);
  } catch {
    logger.error({ event: "spotify.disconnect.failed" });
    return {
      status: "error",
      message: "Spotify could not be disconnected. Try again shortly.",
    };
  }

  logger.info({ event: "spotify.disconnected" });
  revalidatePath(getSafeReturnPath(CONNECTIONS_PATH, CONNECTIONS_PATH));

  return {
    status: "success",
    message:
      "Spotify is disconnected. Stored credentials were destroyed. Playlists already created in Spotify remain in your Spotify account.",
  };
}
