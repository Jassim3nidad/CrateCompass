import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decodeEncryptionKey } from "@/lib/security/encryption-keys";
import {
  openCredential,
  sealCredential,
  TokenDecryptionError,
  type CredentialBinding,
} from "@/lib/security/token-encryption";

const key = randomBytes(32);
const otherKey = randomBytes(32);

const binding: CredentialBinding = {
  purpose: "spotify.refresh_token",
  subjectId: "3f6f4a2e-0d2c-4f52-9f1e-7c0f9a1b2c3d",
  userId: "8b1c0e5a-9d3f-4a71-b2c8-5e6f7a8b9c0d",
  keyVersion: 1,
};

const secret = "AQC-synthetic-refresh-token-value";

function flipFirstByte(buffer: Buffer): void {
  buffer.writeUInt8(buffer.readUInt8(0) ^ 0xff, 0);
}

describe("credential sealing", () => {
  it("round-trips every credential purpose", () => {
    const purposes = [
      "spotify.access_token",
      "spotify.refresh_token",
      "spotify.code_verifier",
    ] as const;

    for (const purpose of purposes) {
      const scoped = { ...binding, purpose };
      const sealed = sealCredential(secret, scoped, key);

      expect(openCredential(sealed, scoped, key)).toBe(secret);
    }
  });

  it("never emits the plaintext inside the ciphertext", () => {
    const sealed = sealCredential(secret, binding, key);

    expect(sealed.ciphertext.toString("utf8")).not.toContain(secret);
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.nonce).toHaveLength(12);
  });

  it("uses a fresh nonce for identical plaintext", () => {
    const first = sealCredential(secret, binding, key);
    const second = sealCredential(secret, binding, key);

    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => sealCredential(secret, binding, randomBytes(16))).toThrow(
      /exactly 32 bytes/,
    );
  });
});

describe("credential opening", () => {
  it("rejects tampered ciphertext", () => {
    const sealed = sealCredential(secret, binding, key);
    flipFirstByte(sealed.ciphertext);

    expect(() => openCredential(sealed, binding, key)).toThrow(
      TokenDecryptionError,
    );
  });

  it("rejects a tampered nonce", () => {
    const sealed = sealCredential(secret, binding, key);
    flipFirstByte(sealed.nonce);

    expect(() => openCredential(sealed, binding, key)).toThrow(
      TokenDecryptionError,
    );
  });

  it("rejects a truncated authentication tag", () => {
    const sealed = sealCredential(secret, binding, key);

    expect(() =>
      openCredential(
        { ...sealed, ciphertext: sealed.ciphertext.subarray(0, 8) },
        binding,
        key,
      ),
    ).toThrow(/malformed ciphertext/);
  });

  it("rejects the wrong key", () => {
    const sealed = sealCredential(secret, binding, key);

    expect(() => openCredential(sealed, binding, otherKey)).toThrow(
      /authentication failed/,
    );
  });

  it("rejects a key version mismatch", () => {
    const sealed = sealCredential(secret, binding, key);

    expect(() =>
      openCredential({ ...sealed, keyVersion: 2 }, binding, key),
    ).toThrow(/key version mismatch/);
  });

  it("never leaks key or ciphertext detail in the error", () => {
    const sealed = sealCredential(secret, binding, key);

    try {
      openCredential(sealed, binding, otherKey);
      expect.unreachable("decryption should have failed");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(key.toString("base64"));
      expect(message).not.toContain(otherKey.toString("base64"));
      expect(message).not.toContain(secret);
    }
  });
});

describe("additional authenticated data binding", () => {
  it("refuses a ciphertext relocated to another user", () => {
    const sealed = sealCredential(secret, binding, key);

    expect(() =>
      openCredential(
        sealed,
        { ...binding, userId: "00000000-0000-4000-8000-000000000001" },
        key,
      ),
    ).toThrow(/authentication failed/);
  });

  it("refuses a refresh-token ciphertext read as an access token", () => {
    const sealed = sealCredential(secret, binding, key);

    expect(() =>
      openCredential(
        sealed,
        { ...binding, purpose: "spotify.access_token" },
        key,
      ),
    ).toThrow(/authentication failed/);
  });

  it("refuses a PKCE verifier replayed into another transaction", () => {
    const transaction = {
      ...binding,
      purpose: "spotify.code_verifier",
    } as const;
    const sealed = sealCredential("verifier-value", transaction, key);

    expect(() =>
      openCredential(
        sealed,
        { ...transaction, subjectId: "00000000-0000-4000-8000-000000000002" },
        key,
      ),
    ).toThrow(/authentication failed/);
  });
});

describe("encryption key decoding", () => {
  it("accepts a base64 key of exactly 32 bytes", () => {
    const encoded = randomBytes(32).toString("base64");

    expect(decodeEncryptionKey(encoded)).toHaveLength(32);
  });

  it("rejects a key of the wrong length", () => {
    expect(() =>
      decodeEncryptionKey(randomBytes(16).toString("base64")),
    ).toThrow(/exactly 32 bytes/);
  });

  it("rejects malformed base64 rather than silently truncating it", () => {
    expect(() => decodeEncryptionKey("not-a-real-key")).toThrow(
      /exactly 32 bytes/,
    );
  });
});
