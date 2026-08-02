import { describe, expect, it } from "vitest";

import { validateServerEnvironment } from "@/lib/validation/environment";

const validEnvironment = {
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  APP_ENV: "test",
  LOG_LEVEL: "info",
  SPOTIFY_TOKEN_ENCRYPTION_KEY_VERSION: "1",
  MUSICBRAINZ_APP_NAME: "CrateCompass",
  MUSICBRAINZ_APP_VERSION: "0.1.0",
  DISCOVERY_PROVIDER: "lastfm",
  AI_PROVIDER: "openai",
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
      SPOTIFY_CLIENT_SECRET: "",
    });

    expect(result.SPOTIFY_CLIENT_SECRET).toBeUndefined();
  });
});
