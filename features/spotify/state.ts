export interface SpotifyActionState {
  readonly status: "idle" | "error" | "success";
  readonly message?: string;
}

/**
 * Outcome of resolving an externally sourced artist to a Spotify link.
 *
 * `ambiguous` and `unresolved` are deliberately first-class. Spotify is used
 * only to link to content the listener already chose elsewhere, so when the
 * deterministic matcher cannot decide, the honest answer is to say so and let
 * the listener pick — never to guess, and never to ask a model to arbitrate.
 */
export type SpotifyLinkState =
  | { readonly status: "idle" }
  | {
      readonly status: "resolved";
      readonly url: string;
      readonly name: string;
      readonly reason: string;
    }
  | {
      readonly status: "ambiguous";
      readonly reason: string;
      readonly options: readonly {
        readonly url: string;
        readonly name: string;
      }[];
    }
  | { readonly status: "unresolved"; readonly reason: string }
  | { readonly status: "not-connected"; readonly message: string }
  | { readonly status: "reconnect-required"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

export const initialSpotifyLinkState: SpotifyLinkState = { status: "idle" };

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
