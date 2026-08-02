export type ProviderName =
  | "musicbrainz"
  | "lastfm"
  | "listenbrainz"
  | "spotify"
  | "openai"
  | "anthropic";

export type ProviderAvailability =
  "available" | "not-configured" | "unavailable" | "degraded";
