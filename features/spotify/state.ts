export interface SpotifyActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
}

export const initialSpotifyActionState: SpotifyActionState = { status: "idle" };

/**
 * Outcomes the OAuth callback can hand back to `/settings/connections`.
 * Kept as a closed union so the page can render an accessible message for
 * every one of them rather than falling through to a generic error.
 */
export const SPOTIFY_CALLBACK_STATUSES = [
  "connected",
  "denied",
  "invalid-state",
  "session-mismatch",
  "insufficient-scope",
  "not-allowlisted",
  "already-linked",
  "quota-exceeded",
  "unavailable",
  "failed",
] as const;

export type SpotifyCallbackStatus = (typeof SPOTIFY_CALLBACK_STATUSES)[number];

export function isSpotifyCallbackStatus(
  value: string | undefined,
): value is SpotifyCallbackStatus {
  return (
    value !== undefined &&
    (SPOTIFY_CALLBACK_STATUSES as readonly string[]).includes(value)
  );
}
