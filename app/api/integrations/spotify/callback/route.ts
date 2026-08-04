import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import { logger } from "@/lib/observability/logger";
import { getCurrentUser } from "@/lib/providers/spotify/client";
import { hasRequiredScopes } from "@/lib/providers/spotify/config";
import {
  digestState,
  exchangeAuthorizationCode,
} from "@/lib/providers/spotify/oauth";
import {
  claimConnection,
  consumeOAuthTransaction,
  SpotifyAccountAlreadyLinkedError,
  storeCredentials,
} from "@/lib/providers/spotify/repository";
import { SpotifyProviderError } from "@/lib/providers/spotify/types";
import {
  getCurrentEncryptionKeyVersion,
  resolveEncryptionKey,
} from "@/lib/security/encryption-keys";
import {
  openCredential,
  sealCredential,
} from "@/lib/security/token-encryption";
import { getSafeReturnPath } from "@/lib/security/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import type { SpotifyCallbackStatus } from "@/features/spotify/state";

const CONNECTIONS_PATH = "/settings/connections";

function outcome(
  request: NextRequest,
  status: SpotifyCallbackStatus,
  path = CONNECTIONS_PATH,
): NextResponse {
  const target = new URL(
    getSafeReturnPath(path, CONNECTIONS_PATH),
    request.url,
  );
  target.searchParams.set("spotify", status);

  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parameters = request.nextUrl.searchParams;

  // The user declined consent, or Spotify refused before issuing a code.
  if (parameters.get("error")) {
    logger.info({
      event: "spotify.callback.denied",
      reason: parameters.get("error"),
    });
    return outcome(request, "denied");
  }

  const code = parameters.get("code");
  const state = parameters.get("state");

  if (!code || !state) {
    return outcome(request, "invalid-state");
  }

  // Atomic single-use claim. A replayed, tampered, expired, or unknown state
  // returns nothing and is indistinguishable from every other bad state.
  const transaction = await consumeOAuthTransaction(digestState(state));

  if (!transaction) {
    logger.warn({ event: "spotify.callback.state_rejected" });
    return outcome(request, "invalid-state");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The transaction is bound to the user who started it. A callback delivered
  // into a different session must not link the account.
  if (!user || user.id !== transaction.userId) {
    logger.warn({ event: "spotify.callback.session_mismatch" });
    return outcome(request, "session-mismatch");
  }

  const redirectPath = getSafeReturnPath(
    transaction.redirectPath,
    CONNECTIONS_PATH,
  );

  try {
    const verifier = openCredential(
      transaction.codeVerifier,
      {
        purpose: "spotify.code_verifier",
        subjectId: transaction.transactionId,
        userId: transaction.userId,
        keyVersion: transaction.codeVerifier.keyVersion,
      },
      resolveEncryptionKey(transaction.codeVerifier.keyVersion),
    );

    const grant = await exchangeAuthorizationCode({
      code,
      codeVerifier: verifier,
    });

    // Refuse to record a connection that cannot perform the one operation it
    // exists for. The user is sent back to a reconnect prompt instead.
    if (!hasRequiredScopes(grant.scopes)) {
      logger.warn({ event: "spotify.callback.insufficient_scope" });
      return outcome(request, "insufficient-scope", redirectPath);
    }

    const profile = await getCurrentUser(grant.accessToken);

    const connectionId = await claimConnection({
      connectionId: randomUUID(),
      userId: user.id,
      spotifyAccountId: profile.accountId,
      displayName: profile.displayName,
      scopes: grant.scopes,
    });

    const keyVersion = getCurrentEncryptionKeyVersion();
    const key = resolveEncryptionKey(keyVersion);
    const binding = { subjectId: connectionId, userId: user.id, keyVersion };

    if (!grant.refreshToken) {
      // An authorization-code exchange always returns one. Without it the
      // connection could never be refreshed, so it is not worth recording.
      logger.error({ event: "spotify.callback.missing_refresh_token" });
      return outcome(request, "failed", redirectPath);
    }

    await storeCredentials({
      connectionId,
      userId: user.id,
      accessToken: sealCredential(
        grant.accessToken,
        { ...binding, purpose: "spotify.access_token" },
        key,
      ),
      refreshToken: sealCredential(
        grant.refreshToken,
        { ...binding, purpose: "spotify.refresh_token" },
        key,
      ),
      tokenExpiresAt: grant.expiresAt,
    });

    logger.info({ event: "spotify.connected" });

    return outcome(request, "connected", redirectPath);
  } catch (error) {
    if (error instanceof SpotifyAccountAlreadyLinkedError) {
      return outcome(request, "already-linked", redirectPath);
    }

    if (error instanceof SpotifyProviderError) {
      logger.warn({ event: "spotify.callback.failed", kind: error.kind });

      if (error.kind === "not-allowlisted") {
        return outcome(request, "not-allowlisted", redirectPath);
      }

      if (error.kind === "quota-exceeded" || error.kind === "rate-limited") {
        return outcome(request, "quota-exceeded", redirectPath);
      }

      if (error.kind === "unavailable") {
        return outcome(request, "unavailable", redirectPath);
      }
    }

    logger.error({ event: "spotify.callback.failed", kind: "unexpected" });

    return outcome(request, "failed", redirectPath);
  }
}
