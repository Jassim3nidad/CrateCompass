import "server-only";

import { getServerEnvironment } from "@/lib/env";
import { ENCRYPTION_KEY_BYTE_LENGTH } from "@/lib/security/token-encryption";

/**
 * Versioned key resolution for ADR 0001 rotation.
 *
 * The current key is `SPOTIFY_TOKEN_ENCRYPTION_KEY`. During a rotation an
 * older key stays available as `SPOTIFY_TOKEN_ENCRYPTION_KEY_V<version>` so
 * rows encrypted under either version keep decrypting until the re-encryption
 * pass completes.
 */

export function decodeEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");

  // Base64 decoding is lenient, so a round-trip comparison is what actually
  // rejects malformed input rather than silently truncating it.
  if (
    key.byteLength !== ENCRYPTION_KEY_BYTE_LENGTH ||
    key.toString("base64") !== encoded
  ) {
    throw new Error(
      `Spotify token encryption key must be base64 decoding to exactly ${ENCRYPTION_KEY_BYTE_LENGTH} bytes.`,
    );
  }

  return key;
}

export function getCurrentEncryptionKeyVersion(): number {
  return getServerEnvironment().SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION;
}

export function resolveEncryptionKey(version: number): Buffer {
  const environment = getServerEnvironment();
  const encoded =
    process.env[`SPOTIFY_TOKEN_ENCRYPTION_KEY_V${version}`] ??
    (version === environment.SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION
      ? environment.SPOTIFY_TOKEN_ENCRYPTION_KEY
      : undefined);

  if (!encoded) {
    throw new Error(
      `No Spotify token encryption key is configured for version ${version}.`,
    );
  }

  return decodeEncryptionKey(encoded);
}
