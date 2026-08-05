import type { ProviderAvailability } from "@/types/provider";
import type { SpotifyConnectionState } from "@/lib/providers/spotify/types";
import type { SpotifyCallbackStatus } from "@/features/spotify/state";
import { REAUTHORIZATION_COPY } from "@/features/spotify/reauthorization-copy";

/**
 * Presentation mapping for every connection and callback state.
 *
 * Kept as exhaustive records rather than conditionals so a new state cannot be
 * added without deciding what the user is told, and so the copy is unit
 * testable without rendering.
 */

export interface ConnectionPresentation {
  readonly badge: ProviderAvailability;
  readonly label: string;
  readonly description: string;
  readonly action: "connect" | "reconnect" | "none";
}

export const connectionPresentation: Record<
  SpotifyConnectionState,
  ConnectionPresentation
> = {
  "not-configured": {
    badge: "not-configured",
    label: "Unavailable",
    description:
      "This deployment has no Spotify application configured, so connecting is not possible right now.",
    action: "none",
  },
  "not-connected": {
    badge: "not-configured",
    label: "Not connected",
    description:
      "CrateCompass works without Spotify. Connect an account only if you want to export approved playlists.",
    action: "connect",
  },
  active: {
    badge: "available",
    label: "Connected",
    description: REAUTHORIZATION_COPY.connectedSummary,
    action: "none",
  },
  expired: {
    badge: "degraded",
    label: "Needs attention",
    description:
      "The stored Spotify authorization could not be used. Reconnecting restores playlist export.",
    action: "reconnect",
  },
  "reauthorization-required": {
    badge: "degraded",
    label: "Reconnect required",
    description:
      "Spotify authorizations expire after six months, and this one has ended. Reconnect to continue exporting playlists.",
    action: "reconnect",
  },
  "insufficient-scope": {
    badge: "degraded",
    // Not "Permission missing": for every account connected before the public
    // scope was added, this state is a product change, not a fault of theirs.
    label: "Reconnect to finish setup",
    description: `${REAUTHORIZATION_COPY.connections.body} ${REAUTHORIZATION_COPY.connections.reassurance}`,
    action: "reconnect",
  },
  revoked: {
    badge: "not-configured",
    label: "Disconnected",
    description:
      "The stored credentials were destroyed. Playlists already created in Spotify remain in your Spotify account.",
    action: "connect",
  },
};

export interface CallbackPresentation {
  readonly tone: "success" | "error";
  readonly message: string;
}

export const callbackPresentation: Record<
  SpotifyCallbackStatus,
  CallbackPresentation
> = {
  connected: {
    tone: "success",
    message:
      "Spotify is connected. Only playlist creation was granted — private by default, public when you choose it.",
  },
  denied: {
    tone: "error",
    message:
      "The Spotify authorization was declined. Nothing was stored and CrateCompass still works without it.",
  },
  "invalid-state": {
    tone: "error",
    message:
      "That authorization link was expired, already used, or did not match this browser. Start the connection again.",
  },
  "session-mismatch": {
    tone: "error",
    message:
      "The authorization finished in a different CrateCompass session. Sign in as the account that started it and try again.",
  },
  "insufficient-scope": {
    tone: "error",
    message: `${REAUTHORIZATION_COPY.declined.heading}. ${REAUTHORIZATION_COPY.declined.body}`,
  },
  "not-allowlisted": {
    tone: "error",
    message:
      "This Spotify account is not on the pilot allowlist. Ask the app owner to add it in the Spotify dashboard.",
  },
  "already-linked": {
    tone: "error",
    message:
      "That Spotify account is already linked to a different CrateCompass account. Disconnect it there first.",
  },
  "quota-exceeded": {
    tone: "error",
    message:
      "Spotify is currently rate limiting or has exhausted this application's quota. Try again later.",
  },
  unavailable: {
    tone: "error",
    message: "Spotify did not respond. Nothing was stored. Try again shortly.",
  },
  failed: {
    tone: "error",
    message:
      "The Spotify connection could not be completed. Nothing was stored. Try again shortly.",
  },
};
