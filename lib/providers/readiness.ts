import "server-only";

import { getServerEnvironment } from "@/lib/env";
import type { ProviderAvailability } from "@/types/provider";

/**
 * What is actually configured, read from the validated environment.
 *
 * The settings page reported provider readiness from hard-coded strings until
 * Phase 10 — MusicBrainz was permanently "not configured" and captioned
 * "arrives in Phase 4", four phases after it shipped. A readiness panel that
 * cannot be wrong is not a readiness panel.
 *
 * This reports *configuration*, not reachability. Pinging MusicBrainz to render
 * a settings page would spend a paced request on every load and turn a
 * transient network blip into "not configured". Live failures surface where the
 * request is made, attributed to the operation that failed.
 */

export interface ProviderReadiness {
  readonly name: string;
  readonly status: ProviderAvailability;
  readonly description: string;
}

const DISCOVERY_PROVIDER_LABELS: Record<string, string> = {
  listenbrainz: "ListenBrainz",
  lastfm: "Last.fm",
};

const AI_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  gemini: "Gemini",
};

/** The Spotify connection states this panel distinguishes. */
export type SpotifyConnectionState = "none" | "active" | "needs-attention";

export function readProviderReadiness(
  connection: SpotifyConnectionState,
): readonly ProviderReadiness[] {
  const environment = getServerEnvironment();

  // Deliberately not `areProviderFixturesEnabled()`. A compliance test asserts
  // that exactly four provider factories import the fixture tree, and that list
  // is a boundary worth more than the small duplication here. The predicate is
  // the same one the environment schema enforces, and the schema refuses to
  // validate PROVIDER_FIXTURES=1 outside a test environment — so this cannot
  // report "fixtures" for a real deployment.
  const fixtures =
    environment.PROVIDER_FIXTURES === "1" && environment.APP_ENV === "test";

  const discoveryLabel =
    DISCOVERY_PROVIDER_LABELS[environment.DISCOVERY_PROVIDER] ??
    environment.DISCOVERY_PROVIDER;
  const aiLabel =
    AI_PROVIDER_LABELS[environment.AI_PROVIDER] ?? environment.AI_PROVIDER;

  return [
    {
      name: "MusicBrainz",
      // No credential exists to check. What MusicBrainz requires is a
      // User-Agent naming a contact, and the environment schema refuses to
      // validate without one — so reaching this line means it is set.
      status: fixtures ? "degraded" : "available",
      description: fixtures
        ? "Serving canned records: this build runs with provider fixtures enabled."
        : `Canonical artists, releases, and discography. Identifying as ${environment.MUSICBRAINZ_APP_NAME}/${environment.MUSICBRAINZ_APP_VERSION}, paced at one request per second.`,
    },
    {
      name: discoveryLabel,
      // ADR 0003 selected ListenBrainz and the Last.fm adapter is deliberately
      // unimplemented, so naming it in the environment is a misconfiguration
      // this panel should show rather than swallow.
      status: fixtures
        ? "degraded"
        : environment.DISCOVERY_PROVIDER === "listenbrainz"
          ? "available"
          : "unavailable",
      description: fixtures
        ? "Serving canned similarity data: this build runs with provider fixtures enabled."
        : environment.DISCOVERY_PROVIDER === "listenbrainz"
          ? "Similar artists and tags. No account or key is required for the endpoints in use."
          : `No adapter is implemented for "${environment.DISCOVERY_PROVIDER}". Discovery will fail until DISCOVERY_PROVIDER is set to listenbrainz.`,
    },
    {
      name: `AI · ${aiLabel}`,
      status: fixtures ? "degraded" : "available",
      description: fixtures
        ? "Serving canned completions: this build runs with provider fixtures enabled."
        : "Mood interpretation, explanations, and grounded answers. Nothing from Spotify is ever included in a request.",
    },
    {
      name: "Spotify",
      status: spotifyStatus(Boolean(environment.SPOTIFY_CLIENT_ID), connection),
      description: spotifyDescription(
        Boolean(environment.SPOTIFY_CLIENT_ID),
        connection,
      ),
    },
  ];
}

function spotifyStatus(
  configured: boolean,
  connection: SpotifyConnectionState,
): ProviderAvailability {
  if (!configured) {
    return "not-configured";
  }

  switch (connection) {
    case "active":
      return "available";
    case "needs-attention":
      return "degraded";
    case "none":
      return "not-configured";
  }
}

function spotifyDescription(
  configured: boolean,
  connection: SpotifyConnectionState,
): string {
  if (!configured) {
    return "No Spotify client is configured for this deployment, so connecting an account and creating playlists are unavailable.";
  }

  switch (connection) {
    case "active":
      return "Connected. Used for links and playlist creation only, never to decide what is recommended.";
    case "needs-attention":
      return "Connected, but the connection needs attention. Reconnect it under Connections.";
    case "none":
      return "Optional connected account. Discovery works without it; playlist creation does not.";
  }
}
