import type { EvidenceFact } from "@/lib/ai/provider";
import type { MusicBrainzId, SourceAttribution } from "@/types/music";

/**
 * Discovery domain types.
 *
 * Everything here is client-safe by construction: there is no field that can
 * hold a Spotify identifier, URI, or payload. Spotify resolution is a separate
 * type (`SpotifyLinkState`) produced by a separate server action, so an
 * evidence object can never acquire Spotify content on its way to the AI layer.
 */

/**
 * How strongly the discovery provider related this candidate, expressed
 * relative to the strongest candidate in the same result set.
 *
 * Deliberately not an absolute quality claim: ListenBrainz scores are
 * unnormalised integers whose scale differs per seed artist, so the only
 * defensible statement is a within-set comparison.
 */
export type MatchStrength = "strong" | "moderate" | "emerging";

/**
 * Whether MusicBrainz enrichment succeeded for this candidate.
 *
 * `similarity-only` is a real, displayable state — the partial-result case —
 * not an error. It means the relationship is known but the shared-tag evidence
 * behind it could not be retrieved.
 */
export type EvidenceDepth = "full" | "similarity-only";

export interface StartingPoint {
  /** MusicBrainz release-group MBID. */
  readonly releaseId: string;
  readonly title: string;
  /** Year only. MusicBrainz partial dates are never padded into a full date. */
  readonly year: string | null;
  readonly primaryType: string | null;
  readonly sourceUrl: string | null;
}

export interface MatchEvidence {
  readonly rank: number;
  readonly totalCandidates: number;
  readonly strength: MatchStrength;
  /** Percentage of the top candidate's score, rounded. Never a quality score. */
  readonly relativeScore: number;
  readonly sharedTags: readonly string[];
  readonly candidateOnlyTags: readonly string[];
  readonly sharedType: string | null;
  readonly sharedCountry: string | null;
  readonly startingPoint: StartingPoint | null;
  readonly depth: EvidenceDepth;
  /**
   * The exact statements an explanation may be grounded in. This array is both
   * what the UI shows as traceable evidence and what the AI layer receives —
   * one list, so the two can never diverge.
   */
  readonly facts: readonly EvidenceFact[];
  readonly attributions: readonly SourceAttribution[];
}

export interface DiscoveryCandidate {
  readonly mbid: MusicBrainzId;
  readonly name: string;
  readonly disambiguation: string | null;
  readonly type: string | null;
  readonly rank: number;
  readonly strength: MatchStrength;
  readonly relativeScore: number;
  readonly sourceUrl: string | null;
  readonly saved: boolean;
}

export type ExplanationSource = "ai" | "template";

export interface DiscoveryExplanation {
  readonly source: ExplanationSource;
  /** Interpretive prose. Always presented as interpretation, never as fact. */
  readonly summary: string;
  readonly sharedCharacteristics: readonly string[];
  readonly contrast: string | null;
  readonly startingPoint: StartingPoint | null;
  /** The evidence statements the summary claims to rest on. */
  readonly groundedIn: readonly string[];
  readonly confidence: "low" | "medium" | "high";
  /** Present when an AI explanation was produced, for model attribution. */
  readonly model: string | null;
}

/** Why a generated explanation was rejected in favour of the template. */
export type ExplanationRejection =
  "ungrounded-claim" | "unknown-release" | "forbidden-content";
