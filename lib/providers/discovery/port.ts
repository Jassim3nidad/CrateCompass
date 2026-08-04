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
 *
 * Phase 0 sketched three methods. Only `findSimilarArtists` is required here:
 * ListenBrainz has no direct equivalent of Last.fm's tag-to-artist and
 * tag-to-track methods, and declaring methods that always throw would hide
 * that gap behind an interface that looks complete. The tag methods are
 * optional so a future provider can supply them and callers can feature-detect
 * rather than discover the gap at runtime.
 */

export type DiscoveryFailureKind =
  | "not-configured"
  | "not-found"
  | "rate-limited"
  | "invalid-response"
  | "unavailable";

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

export interface SimilarArtistsInput {
  readonly mbid: MusicBrainzId;
  readonly limit?: number;
}

export interface DiscoveryProvider {
  readonly name: Provenance;
  findSimilarArtists(input: SimilarArtistsInput): Promise<SimilarityEvidence>;
  /** Not available from ListenBrainz. See ADR 0003 and Phase 7 scope. */
  findArtistsByTags?(input: {
    readonly tags: readonly string[];
  }): Promise<never>;
  findTracksByTags?(input: {
    readonly tags: readonly string[];
  }): Promise<never>;
}
