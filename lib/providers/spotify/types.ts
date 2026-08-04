/**
 * Spotify domain types.
 *
 * Every value that originates from Spotify is branded. Branding is the
 * type-level half of the Spotify-to-AI boundary described in
 * `docs/architecture/provider-boundaries.md`: a branded value is not
 * assignable to the plain `string` fields that AI-safe inputs are built from,
 * so routing one into an AI call fails to compile rather than failing in
 * review. The runtime half lives in `lib/ai/input-guard.ts`.
 */

declare const spotifyBrand: unique symbol;

type Branded<T, Name extends string> = T & {
  readonly [spotifyBrand]: Name;
};

/** Immutable account identifier from `GET /me`. Not the deprecated `id`. */
export type SpotifyAccountId = Branded<string, "SpotifyAccountId">;
export type SpotifyResourceId = Branded<string, "SpotifyResourceId">;
export type SpotifyUri = Branded<string, "SpotifyUri">;

/** Marks a whole object graph as Spotify-derived. */
export type SpotifyDerived<T> = T & {
  readonly [spotifyBrand]: "SpotifyDerived";
};

export function asSpotifyAccountId(value: string): SpotifyAccountId {
  return value as SpotifyAccountId;
}

export function asSpotifyResourceId(value: string): SpotifyResourceId {
  return value as SpotifyResourceId;
}

export function asSpotifyUri(value: string): SpotifyUri {
  return value as SpotifyUri;
}

/**
 * Why a Spotify call failed, in terms the product can act on. The transport
 * status is kept for logging but never drives user-facing copy directly.
 */
export type SpotifyFailureKind =
  | "not-configured"
  | "unauthorized"
  | "insufficient-scope"
  | "not-allowlisted"
  | "rate-limited"
  | "quota-exceeded"
  | "reauthorization-required"
  | "invalid-request"
  | "invalid-response"
  | "unavailable";

export class SpotifyProviderError extends Error {
  readonly kind: SpotifyFailureKind;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: SpotifyFailureKind,
    message: string,
    options: {
      readonly status?: number | undefined;
      readonly retryAfterSeconds?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = "SpotifyProviderError";
    this.kind = kind;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** Connection state as presented to the user. */
export type SpotifyConnectionState =
  | "not-configured"
  | "not-connected"
  | "active"
  | "expired"
  | "reauthorization-required"
  | "insufficient-scope"
  | "revoked";

export interface SpotifyConnectionSummary {
  readonly state: SpotifyConnectionState;
  readonly accountId: SpotifyAccountId | null;
  readonly displayName: string | null;
  readonly scopes: readonly string[];
  readonly connectedAt: string | null;
  readonly lastVerifiedAt: string | null;
}

export interface SpotifyProfile {
  readonly accountId: SpotifyAccountId;
  readonly displayName: string | null;
  readonly profileUrl: string | null;
}

export interface SpotifyAccessGrant {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly scopes: readonly string[];
  readonly expiresAt: Date;
}
