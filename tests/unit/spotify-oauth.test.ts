import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  digestState,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from "@/lib/providers/spotify/oauth";
import { SpotifyProviderError } from "@/lib/providers/spotify/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PKCE", () => {
  it("produces a verifier inside RFC 7636's length bounds", () => {
    const { verifier } = createPkcePair();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("derives the challenge as base64url SHA-256 of the verifier", () => {
    const { verifier, challenge } = createPkcePair();

    expect(challenge).toBe(
      createHash("sha256").update(verifier, "ascii").digest("base64url"),
    );
  });

  it("is unpredictable between calls", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe("state", () => {
  it("stores only a digest, never the state itself", () => {
    const { state, digest } = createOAuthState();

    expect(digest.equals(digestState(state))).toBe(true);
    expect(digest.toString("utf8")).not.toContain(state);
    expect(digest).toHaveLength(32);
  });

  it("produces a different digest for a tampered state", () => {
    const { state, digest } = createOAuthState();

    expect(digestState(`${state}x`).equals(digest)).toBe(false);
  });
});

describe("authorize URL", () => {
  it("requests only the two playlist scopes and uses S256", () => {
    const url = new URL(
      buildAuthorizeUrl({ state: "state-value", codeChallenge: "challenge" }),
    );

    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // Both playlist-modification scopes and nothing else. A scope appearing
    // here that is not in this list is a compliance regression, not a feature.
    expect(url.searchParams.get("scope")).toBe(
      "playlist-modify-private playlist-modify-public",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/integrations/spotify/callback",
    );
  });

  it("never places a client secret in the authorization URL", () => {
    const url = buildAuthorizeUrl({ state: "s", codeChallenge: "c" });

    expect(url).not.toContain("client_secret");
    expect(url).not.toContain(process.env.SPOTIFY_CLIENT_SECRET ?? "unset");
  });
});

describe("token exchange", () => {
  it("sends client_id and code_verifier, and no client authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "access-value",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "playlist-modify-private",
        refresh_token: "refresh-value",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const grant = await exchangeAuthorizationCode({
      code: "auth-code",
      codeVerifier: "verifier",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);

    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("synthetic-test-client-id");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("client_secret")).toBeNull();
    expect(
      (init.headers as Record<string, string>)["Authorization"],
    ).toBeUndefined();

    expect(grant.accessToken).toBe("access-value");
    expect(grant.refreshToken).toBe("refresh-value");
    expect(grant.scopes).toEqual(["playlist-modify-private"]);
  });

  it("maps invalid_grant to a reauthorization requirement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400)),
    );

    await expect(
      exchangeAuthorizationCode({ code: "c", codeVerifier: "v" }),
    ).rejects.toMatchObject({ kind: "reauthorization-required" });
  });

  it("rejects a malformed token response rather than trusting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ access_token: "" })),
    );

    await expect(
      exchangeAuthorizationCode({ code: "c", codeVerifier: "v" }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("surfaces a network failure as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket")));

    await expect(
      exchangeAuthorizationCode({ code: "c", codeVerifier: "v" }),
    ).rejects.toBeInstanceOf(SpotifyProviderError);
  });
});

describe("refresh", () => {
  it("sends client_id in the body, as the PKCE flow requires", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: "new-access",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const grant = await refreshAccessToken("stored-refresh");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);

    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh");
    expect(body.get("client_id")).toBe("synthetic-test-client-id");
    expect(body.get("client_secret")).toBeNull();

    // Spotify does not always rotate. A missing refresh_token is success.
    expect(grant.refreshToken).toBeNull();
    expect(grant.accessToken).toBe("new-access");
  });
});
