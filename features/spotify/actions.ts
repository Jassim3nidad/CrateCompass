"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { resolveSpotifyArtist } from "@/lib/matching/artist-resolution";
import { logger } from "@/lib/observability/logger";
import { getMusicBrainzClient } from "@/lib/providers/musicbrainz";
import { MusicBrainzError } from "@/lib/providers/musicbrainz/client";
import { search } from "@/lib/providers/spotify/client";
import { getAccessToken } from "@/lib/providers/spotify/token-manager";
import { SpotifyProviderError } from "@/lib/providers/spotify/types";
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
import { getAuthenticatedUser, getOptionalUser } from "@/lib/supabase/auth";
import type {
  SpotifyActionState,
  SpotifyLinkState,
} from "@/features/spotify/state";

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

const SPOTIFY_ARTIST_URL = "https://open.spotify.com/artist/";

const linkInputSchema = z.object({ mbid: z.uuid() });

/**
 * Resolves a MusicBrainz artist to a Spotify link, on demand.
 *
 * Deliberate properties:
 *
 * - **The canonical name comes from MusicBrainz, not from the browser.** The
 *   caller supplies an identifier; the name and aliases used for matching are
 *   fetched server-side, so a crafted request cannot steer the Spotify search.
 * - **Nothing is persisted.** The resolution is recomputed per request, which
 *   keeps the application from accumulating a Spotify catalogue mirror and
 *   means a link is never stale.
 * - **No AI import exists in this module.** Identity arbitration is
 *   deterministic (`lib/matching/artist-resolution.ts`), and a tie is handed to
 *   the listener rather than to a model.
 */
export async function resolveArtistOnSpotifyAction(
  input: unknown,
): Promise<SpotifyLinkState> {
  const parsed = linkInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "unavailable",
      message: "That request could not be understood.",
    };
  }

  const { user } = await getOptionalUser();

  if (!user) {
    return {
      status: "not-connected",
      message: "Sign in and connect Spotify to open results there.",
    };
  }

  if (!isSpotifyConfigured()) {
    return {
      status: "unavailable",
      message: "Spotify is not configured for this deployment.",
    };
  }

  let canonical;

  try {
    canonical = (await getMusicBrainzClient().lookupArtist(parsed.data.mbid))
      .artist;
  } catch (error) {
    if (!(error instanceof MusicBrainzError)) {
      throw error;
    }

    return {
      status: "unavailable",
      message:
        "The canonical artist record could not be read, so no link can be resolved.",
    };
  }

  let accessToken: string;

  try {
    accessToken = await getAccessToken(user.id);
  } catch (error) {
    if (!(error instanceof SpotifyProviderError)) {
      throw error;
    }

    if (error.kind === "reauthorization-required") {
      return {
        status: "not-connected",
        message: "Connect Spotify to open results there.",
      };
    }

    if (error.kind === "insufficient-scope") {
      return {
        status: "reconnect-required",
        message:
          "The Spotify connection is missing a required permission. Reconnect to continue.",
      };
    }

    return {
      status: "unavailable",
      message: "Spotify could not be reached. Try again shortly.",
    };
  }

  try {
    const results = await search(accessToken, {
      query: canonical.name,
      types: ["artist"],
    });

    const resolution = resolveSpotifyArtist({
      canonical,
      options: results.artists.map((artist) => ({
        id: artist.id,
        uri: artist.uri,
        name: artist.name,
      })),
    });

    if (resolution.confidence === "confident" && resolution.selected) {
      return {
        status: "resolved",
        url: `${SPOTIFY_ARTIST_URL}${resolution.selected.spotifyId}`,
        name: resolution.selected.name,
        reason: resolution.reason,
      };
    }

    if (resolution.confidence === "ambiguous") {
      return {
        status: "ambiguous",
        reason: resolution.reason,
        options: resolution.alternatives.map((match) => ({
          url: `${SPOTIFY_ARTIST_URL}${match.spotifyId}`,
          name: match.name,
        })),
      };
    }

    return { status: "unresolved", reason: resolution.reason };
  } catch (error) {
    if (!(error instanceof SpotifyProviderError)) {
      throw error;
    }

    logger.warn({ event: "spotify.link_resolution_failed", kind: error.kind });

    if (error.kind === "unauthorized") {
      return {
        status: "reconnect-required",
        message: "The Spotify connection needs to be renewed.",
      };
    }

    return {
      status: "unavailable",
      message:
        error.kind === "rate-limited" || error.kind === "quota-exceeded"
          ? "Spotify is rate limiting requests. Try again shortly."
          : "Spotify could not be reached. Try again shortly.",
    };
  }
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
