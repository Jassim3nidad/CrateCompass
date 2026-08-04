import { describe, expect, it } from "vitest";

import {
  callbackPresentation,
  connectionPresentation,
} from "@/features/spotify/connection-presentation";
import {
  isSpotifyCallbackStatus,
  SPOTIFY_CALLBACK_STATUSES,
} from "@/features/spotify/state";
import { decodeBytea, encodeBytea } from "@/lib/providers/spotify/repository";

/**
 * Required interface states. The Phase 3 brief lists loading, error, expired,
 * revoked, insufficient scope and success as mandatory; these assert that each
 * one has copy and an action rather than falling through to a generic error.
 */

const requiredConnectionStates = [
  "not-configured",
  "not-connected",
  "active",
  "expired",
  "reauthorization-required",
  "insufficient-scope",
  "revoked",
] as const;

describe("connection states", () => {
  it.each(requiredConnectionStates)("presents the %s state", (state) => {
    const presentation = connectionPresentation[state];

    expect(presentation.label.length).toBeGreaterThan(0);
    expect(presentation.description.length).toBeGreaterThan(0);
    expect(["connect", "reconnect", "none"]).toContain(presentation.action);
  });

  it("offers a reconnect path from every recoverable state", () => {
    expect(connectionPresentation.expired.action).toBe("reconnect");
    expect(connectionPresentation["reauthorization-required"].action).toBe(
      "reconnect",
    );
    expect(connectionPresentation["insufficient-scope"].action).toBe(
      "reconnect",
    );
  });

  it("offers no action when Spotify is not configured for the deployment", () => {
    expect(connectionPresentation["not-configured"].action).toBe("none");
  });

  it("explains the six-month expiry in the reauthorization copy", () => {
    expect(
      connectionPresentation["reauthorization-required"].description,
    ).toMatch(/six months/i);
  });

  it("tells the user their existing playlists survive disconnection", () => {
    expect(connectionPresentation.revoked.description).toMatch(
      /remain in your Spotify account/i,
    );
  });
});

describe("callback states", () => {
  it.each(SPOTIFY_CALLBACK_STATUSES)("presents the %s outcome", (status) => {
    const presentation = callbackPresentation[status];

    expect(presentation.message.length).toBeGreaterThan(0);
    expect(["success", "error"]).toContain(presentation.tone);
  });

  it("treats only a completed connection as success", () => {
    const successes = SPOTIFY_CALLBACK_STATUSES.filter(
      (status) => callbackPresentation[status].tone === "success",
    );

    expect(successes).toEqual(["connected"]);
  });

  it("states that nothing was stored on every failure that stored nothing", () => {
    for (const status of ["denied", "unavailable", "failed"] as const) {
      expect(callbackPresentation[status].message).toMatch(
        /nothing was stored/i,
      );
    }
  });

  it("rejects an unknown status from the query string", () => {
    expect(isSpotifyCallbackStatus("connected")).toBe(true);
    expect(isSpotifyCallbackStatus("javascript:alert(1)")).toBe(false);
    expect(isSpotifyCallbackStatus(undefined)).toBe(false);
  });
});

describe("bytea codec", () => {
  it("round-trips binary through PostgREST's hex representation", () => {
    const value = Buffer.from([0x00, 0xff, 0x10, 0x7f]);
    const encoded = encodeBytea(value);

    expect(encoded).toBe("\\x00ff107f");
    expect(decodeBytea(encoded).equals(value)).toBe(true);
  });

  it("refuses a representation it does not recognise", () => {
    expect(() => decodeBytea("00ff107f")).toThrow(/bytea/i);
  });
});
