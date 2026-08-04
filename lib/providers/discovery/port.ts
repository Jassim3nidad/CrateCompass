import type {
  MusicBrainzId,
  Provenance,
  SimilarityEvidence,
} from "@/types/music";

/**
 * Provider-neutral discovery port.
 *
 * Product services depend on this interface, never on ListenBrainz directly,
 * so replacing the source is an adapter change (ADR 0003).
 */

export type DiscoveryFailureKind =
  | "not-configured"
  | "not-found"
  | "invalid-request"
  | "rate-limited"
  | "invalid-response"
  | "unavailable"
  /** The selected provider cannot perform this operation at all. */
  | "unsupported";

export class DiscoveryProviderError extends Error {
  readonly kind: DiscoveryFailureKind;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: DiscoveryFailureKind,
    message: string,
    retryAfterSeconds?: number | undefined,
  ) {
    super(message);
    this.name = "DiscoveryProviderError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UnsupportedDiscoveryOperationError extends DiscoveryProviderError {
  constructor(operation: string, provider: string) {
    super(
      "unsupported",
      `${operation} is not supported by the ${provider} discovery provider.`,
    );
    this.name = "UnsupportedDiscoveryOperationError";
  }
}

export interface SimilarArtistsInput {
  readonly mbid: MusicBrainzId;
  readonly limit?: number;
}

export interface TagQueryInput {
  readonly tags: readonly string[];
  readonly limit?: number;
}

/**
 * All three methods are **required**, including the two ListenBrainz cannot
 * serve.
 *
 * They were previously optional, which was a mistake: an absent optional method
 * either returns `undefined` through `?.()` or throws a bare `TypeError`, and
 * in the first case a caller cannot tell "this provider has no tag search" from
 * "tag search found nothing". Declaring them and throwing
 * `UnsupportedDiscoveryOperationError` makes the gap explicit at the call site
 * and impossible to mistake for zero results.
 */
export interface DiscoveryProvider {
  readonly name: Provenance;
  findSimilarArtists(input: SimilarArtistsInput): Promise<SimilarityEvidence>;
  /** Unsupported on ListenBrainz. See docs/product/phase-7-mood-scope.md. */
  findArtistsByTags(input: TagQueryInput): Promise<never>;
  /** Unsupported on ListenBrainz. See docs/product/phase-7-mood-scope.md. */
  findTracksByTags(input: TagQueryInput): Promise<never>;
}
