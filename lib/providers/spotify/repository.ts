import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SealedCredential } from "@/lib/security/token-encryption";

/**
 * Typed access to the Phase 3 `security definer` RPCs.
 *
 * The credential tables live in the `private` schema, which PostgREST does not
 * expose, so every read and write here goes through a function whose EXECUTE
 * privilege is granted only to `service_role`. That is also why this module is
 * the only place the admin client is used for Spotify work.
 */

/** PostgREST represents `bytea` as a hex string prefixed with `\x`. */
export function encodeBytea(buffer: Buffer): string {
  return `\\x${buffer.toString("hex")}`;
}

export function decodeBytea(value: string): Buffer {
  if (!value.startsWith("\\x")) {
    throw new Error("Unexpected bytea encoding from the database.");
  }

  return Buffer.from(value.slice(2), "hex");
}

export interface StoredCredentials {
  readonly connectionId: string;
  readonly spotifyAccountId: string;
  readonly status: string;
  readonly scopes: readonly string[];
  readonly accessToken: SealedCredential;
  readonly refreshToken: SealedCredential;
  readonly tokenExpiresAt: Date;
}

export interface ClaimedOAuthTransaction {
  readonly transactionId: string;
  readonly userId: string;
  readonly codeVerifier: SealedCredential;
  readonly redirectPath: string;
}

function failOn(error: { message: string; code?: string } | null): void {
  if (error) {
    // Provider and credential detail must not travel with the message.
    throw new Error(
      `Spotify connection storage failed (${error.code ?? "db"}).`,
    );
  }
}

export async function beginOAuthTransaction(input: {
  readonly transactionId: string;
  readonly userId: string;
  readonly stateDigest: Buffer;
  readonly codeVerifier: SealedCredential;
  readonly redirectPath: string;
  readonly expiresAt: Date;
}): Promise<void> {
  const { error } = await createAdminClient().rpc("begin_spotify_oauth", {
    p_transaction_id: input.transactionId,
    p_user_id: input.userId,
    p_state_digest: encodeBytea(input.stateDigest),
    p_code_verifier_ciphertext: encodeBytea(input.codeVerifier.ciphertext),
    p_code_verifier_nonce: encodeBytea(input.codeVerifier.nonce),
    p_encryption_key_version: input.codeVerifier.keyVersion,
    p_redirect_path: input.redirectPath,
    p_expires_at: input.expiresAt.toISOString(),
  });

  failOn(error);
}

export async function consumeOAuthTransaction(
  stateDigest: Buffer,
): Promise<ClaimedOAuthTransaction | null> {
  const { data, error } = await createAdminClient().rpc(
    "consume_spotify_oauth",
    { p_state_digest: encodeBytea(stateDigest) },
  );

  failOn(error);

  const claimed = data?.[0];
  if (!claimed) {
    return null;
  }

  return {
    transactionId: claimed.transaction_id,
    userId: claimed.user_id,
    codeVerifier: {
      ciphertext: decodeBytea(claimed.code_verifier_ciphertext),
      nonce: decodeBytea(claimed.code_verifier_nonce),
      keyVersion: claimed.encryption_key_version,
    },
    redirectPath: claimed.redirect_path,
  };
}

export async function claimConnection(input: {
  readonly connectionId: string;
  readonly userId: string;
  readonly spotifyAccountId: string;
  readonly displayName: string | null;
  readonly scopes: readonly string[];
}): Promise<string> {
  const { data, error } = await createAdminClient().rpc(
    "claim_spotify_connection",
    {
      p_connection_id: input.connectionId,
      p_user_id: input.userId,
      p_spotify_user_id: input.spotifyAccountId,
      p_display_name: input.displayName ?? "",
      p_scopes: [...input.scopes],
    },
  );

  if (error?.code === "CC001") {
    throw new SpotifyAccountAlreadyLinkedError();
  }

  failOn(error);

  if (!data) {
    throw new Error("Spotify connection storage failed (no connection id).");
  }

  return data;
}

export class SpotifyAccountAlreadyLinkedError extends Error {
  constructor() {
    super(
      "This Spotify account is already linked to another CrateCompass account.",
    );
    this.name = "SpotifyAccountAlreadyLinkedError";
  }
}

export async function storeCredentials(input: {
  readonly connectionId: string;
  readonly userId: string;
  readonly accessToken: SealedCredential;
  readonly refreshToken: SealedCredential;
  readonly tokenExpiresAt: Date;
}): Promise<void> {
  const { error } = await createAdminClient().rpc("store_spotify_credentials", {
    p_connection_id: input.connectionId,
    p_user_id: input.userId,
    p_access_token_ciphertext: encodeBytea(input.accessToken.ciphertext),
    p_access_token_nonce: encodeBytea(input.accessToken.nonce),
    p_refresh_token_ciphertext: encodeBytea(input.refreshToken.ciphertext),
    p_refresh_token_nonce: encodeBytea(input.refreshToken.nonce),
    p_encryption_key_version: input.accessToken.keyVersion,
    p_token_expires_at: input.tokenExpiresAt.toISOString(),
  });

  failOn(error);
}

export async function readCredentials(
  userId: string,
): Promise<StoredCredentials | null> {
  const { data, error } = await createAdminClient().rpc(
    "read_spotify_credentials",
    { p_user_id: userId },
  );

  failOn(error);

  const row = data?.[0];
  if (!row) {
    return null;
  }

  return {
    connectionId: row.connection_id,
    spotifyAccountId: row.spotify_user_id,
    status: row.status,
    scopes: row.scopes,
    accessToken: {
      ciphertext: decodeBytea(row.access_token_ciphertext),
      nonce: decodeBytea(row.access_token_nonce),
      keyVersion: row.encryption_key_version,
    },
    refreshToken: {
      ciphertext: decodeBytea(row.refresh_token_ciphertext),
      nonce: decodeBytea(row.refresh_token_nonce),
      keyVersion: row.encryption_key_version,
    },
    tokenExpiresAt: new Date(row.token_expires_at),
  };
}

/**
 * Compare-and-set. Returns false when another instance refreshed first, in
 * which case the caller re-reads rather than overwriting a newer token.
 */
export async function rotateCredentials(input: {
  readonly connectionId: string;
  readonly userId: string;
  readonly expectedTokenExpiresAt: Date;
  readonly accessToken: SealedCredential;
  readonly refreshToken: SealedCredential;
  readonly tokenExpiresAt: Date;
}): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc(
    "rotate_spotify_credentials",
    {
      p_connection_id: input.connectionId,
      p_user_id: input.userId,
      p_expected_token_expires_at: input.expectedTokenExpiresAt.toISOString(),
      p_access_token_ciphertext: encodeBytea(input.accessToken.ciphertext),
      p_access_token_nonce: encodeBytea(input.accessToken.nonce),
      p_refresh_token_ciphertext: encodeBytea(input.refreshToken.ciphertext),
      p_refresh_token_nonce: encodeBytea(input.refreshToken.nonce),
      p_encryption_key_version: input.accessToken.keyVersion,
      p_token_expires_at: input.tokenExpiresAt.toISOString(),
    },
  );

  failOn(error);

  return data === true;
}

export async function markConnectionExpired(userId: string): Promise<void> {
  const { error } = await createAdminClient().rpc(
    "mark_spotify_connection_expired",
    { p_user_id: userId },
  );

  failOn(error);
}

export async function disconnect(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("disconnect_spotify", {
    p_user_id: userId,
  });

  failOn(error);

  return data === true;
}
