import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for Spotify credentials, per ADR 0001.
 *
 * Every ciphertext is bound to its purpose and its owning row through AES-GCM
 * additional authenticated data. A ciphertext therefore cannot be moved between
 * users, between columns, or between OAuth transactions: the substitution
 * decrypts to an authentication failure rather than to a usable secret.
 */

export type CredentialPurpose =
  "spotify.access_token" | "spotify.refresh_token" | "spotify.code_verifier";

export const ENCRYPTION_KEY_BYTE_LENGTH = 32;

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;

export class TokenDecryptionError extends Error {
  constructor(reason: string) {
    super(`Stored credential could not be decrypted: ${reason}`);
    this.name = "TokenDecryptionError";
  }
}

export interface CredentialBinding {
  readonly purpose: CredentialPurpose;
  /** Connection id, or OAuth transaction id when sealing a PKCE verifier. */
  readonly subjectId: string;
  readonly userId: string;
  readonly keyVersion: number;
}

export interface SealedCredential {
  /** Ciphertext with the 16-byte GCM authentication tag appended. */
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly keyVersion: number;
}

function assertKey(key: Buffer): void {
  if (key.byteLength !== ENCRYPTION_KEY_BYTE_LENGTH) {
    throw new Error(
      `Encryption key must be exactly ${ENCRYPTION_KEY_BYTE_LENGTH} bytes.`,
    );
  }
}

function buildAdditionalData(binding: CredentialBinding): Buffer {
  return Buffer.from(
    `${binding.purpose}|${binding.subjectId}|${binding.userId}|${binding.keyVersion}`,
    "utf8",
  );
}

export function sealCredential(
  plaintext: string,
  binding: CredentialBinding,
  key: Buffer,
): SealedCredential {
  assertKey(key);

  const nonce = randomBytes(NONCE_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });
  cipher.setAAD(buildAdditionalData(binding));

  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]),
    nonce,
    keyVersion: binding.keyVersion,
  };
}

export function openCredential(
  sealed: SealedCredential,
  binding: CredentialBinding,
  key: Buffer,
): string {
  assertKey(key);

  if (sealed.keyVersion !== binding.keyVersion) {
    throw new TokenDecryptionError("key version mismatch");
  }

  if (sealed.nonce.byteLength !== NONCE_BYTE_LENGTH) {
    throw new TokenDecryptionError("malformed nonce");
  }

  if (sealed.ciphertext.byteLength <= AUTH_TAG_BYTE_LENGTH) {
    throw new TokenDecryptionError("malformed ciphertext");
  }

  const tagOffset = sealed.ciphertext.byteLength - AUTH_TAG_BYTE_LENGTH;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, sealed.nonce, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });
    decipher.setAAD(buildAdditionalData(binding));
    decipher.setAuthTag(sealed.ciphertext.subarray(tagOffset));

    return Buffer.concat([
      decipher.update(sealed.ciphertext.subarray(0, tagOffset)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The underlying error is swallowed deliberately: it can carry key and
    // ciphertext detail that must never reach a log line or an error response.
    throw new TokenDecryptionError("authentication failed");
  }
}
