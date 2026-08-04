import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateServerEnvironment } from "@/lib/validation/environment";

const validEncryptionKey = randomBytes(32).toString("base64");
const spotifyEnvironment = {
  SPOTIFY_CLIENT_ID: "synthetic-client-id",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/integrations/spotify/callback",
  SPOTIFY_TOKEN_ENCRYPTION_KEY: validEncryptionKey,
};

const validEnvironment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  APP_ENV: "test",
  LOG_LEVEL: "info",
  SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION: "1",
  MUSICBRAINZ_APP_NAME: "CrateCompass",
  MUSICBRAINZ_APP_VERSION: "0.1.0",
  MUSICBRAINZ_CONTACT: "maintainer@cratecompass.invalid",
  DISCOVERY_PROVIDER: "listenbrainz",
  AI_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "sk-ant-synthetic",
  ANTHROPIC_MODEL: "claude-opus-5",
};

describe("environment validation", () => {
  it("accepts the documented foundation environment", () => {
    const result = validateServerEnvironment(validEnvironment);

    expect(result.APP_ENV).toBe("test");
    expect(result.SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION).toBe(1);
  });

  it("fails clearly when required variables are absent", () => {
    expect(() => validateServerEnvironment({ NODE_ENV: "test" })).toThrow(
      /Invalid CrateCompass environment:.*NEXT_PUBLIC_APP_URL/i,
    );
  });

  it("rejects localhost in favor of an explicit loopback address", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toThrow(/explicit loopback IP/i);
  });

  it("treats blank optional secrets as absent", () => {
    const result = validateServerEnvironment({
      ...validEnvironment,
      LISTENBRAINZ_USER_TOKEN: "",
    });

    expect(result.LISTENBRAINZ_USER_TOKEN).toBeUndefined();
  });
});

describe("AI provider environment", () => {
  it("requires only the selected provider's credentials", () => {
    // Requiring both providers' keys would make switching AI_PROVIDER a
    // deployment change rather than a configuration one.
    expect(() => validateServerEnvironment(validEnvironment)).not.toThrow();
  });

  it("rejects a selected provider with no key", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        ANTHROPIC_API_KEY: undefined,
      }),
    ).toThrow(/ANTHROPIC_API_KEY.*AI_PROVIDER is "anthropic"/i);
  });

  it("rejects a selected provider with no model", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        ANTHROPIC_MODEL: undefined,
      }),
    ).toThrow(/ANTHROPIC_MODEL.*AI_PROVIDER is "anthropic"/i);
  });

  it("requires OpenRouter credentials when it is selected", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        AI_PROVIDER: "openrouter",
      }),
    ).toThrow(/OPENROUTER_API_KEY.*AI_PROVIDER is "openrouter"/i);

    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        AI_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-v1-synthetic",
        OPENROUTER_MODEL: "google/gemini-3.1-flash-lite",
      }),
    ).not.toThrow();
  });

  it("switches which credentials are required when the provider changes", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        AI_PROVIDER: "openai",
      }),
    ).toThrow(/OPENAI_API_KEY.*AI_PROVIDER is "openai"/i);

    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "sk-synthetic",
        OPENAI_MODEL: "gpt-synthetic",
      }),
    ).not.toThrow();
  });
});

describe("Spotify connected-account environment", () => {
  it("does not require Spotify variables when the integration is unconfigured", () => {
    expect(() => validateServerEnvironment(validEnvironment)).not.toThrow();
  });

  it("accepts a fully configured PKCE integration", () => {
    const result = validateServerEnvironment({
      ...validEnvironment,
      ...spotifyEnvironment,
    });

    expect(result.SPOTIFY_TOKEN_ENCRYPTION_KEY).toBe(validEncryptionKey);
  });

  it("validates a complete Spotify setup with no client secret present", () => {
    // ADR 0002: PKCE never reads one. The companion compliance test asserts
    // that no application module references the variable at all.
    const result = validateServerEnvironment({
      ...validEnvironment,
      ...spotifyEnvironment,
    });

    expect(result.SPOTIFY_CLIENT_ID).toBe("synthetic-client-id");
    expect(result.SPOTIFY_REDIRECT_URI).toBe(
      spotifyEnvironment.SPOTIFY_REDIRECT_URI,
    );
  });

  it("requires an encryption key once a client id is present", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        SPOTIFY_CLIENT_ID: spotifyEnvironment.SPOTIFY_CLIENT_ID,
        SPOTIFY_REDIRECT_URI: spotifyEnvironment.SPOTIFY_REDIRECT_URI,
      }),
    ).toThrow(/SPOTIFY_TOKEN_ENCRYPTION_KEY.*is required/i);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        ...spotifyEnvironment,
        SPOTIFY_TOKEN_ENCRYPTION_KEY: randomBytes(16).toString("base64"),
      }),
    ).toThrow(/exactly 32 bytes/i);
  });

  it("rejects malformed base64 in the encryption key", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        ...spotifyEnvironment,
        SPOTIFY_TOKEN_ENCRYPTION_KEY: "clearly-not-base64-material",
      }),
    ).toThrow(/exactly 32 bytes/i);
  });

  it("requires a redirect URI once a client id is present", () => {
    expect(() =>
      validateServerEnvironment({
        ...validEnvironment,
        SPOTIFY_CLIENT_ID: spotifyEnvironment.SPOTIFY_CLIENT_ID,
        SPOTIFY_TOKEN_ENCRYPTION_KEY:
          spotifyEnvironment.SPOTIFY_TOKEN_ENCRYPTION_KEY,
      }),
    ).toThrow(/SPOTIFY_REDIRECT_URI.*is required/i);
  });
});
