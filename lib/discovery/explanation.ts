import type { ArtistMatchExplanation } from "@/lib/ai/schemas";
import type {
  DiscoveryExplanation,
  ExplanationRejection,
  MatchEvidence,
  StartingPoint,
} from "@/lib/discovery/types";

/**
 * Explanation construction and verification.
 *
 * Two guarantees live here, and both are enforced after the model answers
 * rather than requested politely in a prompt:
 *
 * 1. **Every claim is traceable.** Each entry the model lists in `groundedIn`
 *    must correspond to a supplied evidence statement. One that does not means
 *    the model is drawing on something we did not give it, so the whole output
 *    is discarded rather than partially trusted.
 * 2. **No invented release.** A suggested starting point must be one of the
 *    release-group identifiers supplied from MusicBrainz.
 *
 * When either check fails, the deterministic template is used instead. The
 * template restates provider facts and says plainly that the relationship is
 * reported rather than characterising music nobody supplied evidence about.
 */

const MIN_CLAIM_SUPPORT = 0.5;
const MAX_SUMMARY_LENGTH = 1200;

/**
 * Words carrying no matching signal. Kept deliberately small: an aggressive
 * list would strip domain words and make an unsupported claim look supported.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "both",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "they",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function significantTokens(value: string): readonly string[] {
  return (
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token))
      // Crude singularisation so "tags" matches "tag". Enough for containment
      // scoring; nothing here depends on linguistic correctness.
      .map((token) =>
        token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token,
      )
  );
}

/**
 * Containment of the claim in a fact, not similarity between the two.
 *
 * A claim is a short paraphrase of a longer statement, so symmetric measures
 * penalise exactly the case that should pass. What matters is whether the
 * claim's own words are accounted for by the fact.
 */
export function claimSupport(claim: string, factStatement: string): number {
  const claimTokens = significantTokens(claim);

  if (claimTokens.length === 0) {
    return 0;
  }

  const factTokens = new Set(significantTokens(factStatement));
  const matched = claimTokens.filter((token) => factTokens.has(token)).length;

  return matched / claimTokens.length;
}

function isGrounded(claim: string, evidence: MatchEvidence): boolean {
  return evidence.facts.some(
    (fact) => claimSupport(claim, fact.statement) >= MIN_CLAIM_SUPPORT,
  );
}

/** Defence in depth. The AI layer never receives Spotify content, so an output
 * that mentions it came from the model's own priors, not from our evidence. */
const FORBIDDEN_OUTPUT_PATTERN = /spotify/i;

export interface VerifyExplanationInput {
  readonly output: ArtistMatchExplanation;
  readonly evidence: MatchEvidence;
  /** Release groups supplied to the model, keyed by MusicBrainz identifier. */
  readonly allowedReleases: readonly StartingPoint[];
  readonly model: string;
}

export type VerifyExplanationResult =
  | { readonly ok: true; readonly explanation: DiscoveryExplanation }
  | { readonly ok: false; readonly reason: ExplanationRejection };

export function verifyExplanation(
  input: VerifyExplanationInput,
): VerifyExplanationResult {
  const { output, evidence } = input;

  const prose = [
    output.explanation,
    output.contrast ?? "",
    ...output.sharedCharacteristics,
  ].join(" ");

  if (FORBIDDEN_OUTPUT_PATTERN.test(prose)) {
    return { ok: false, reason: "forbidden-content" };
  }

  if (!output.groundedIn.every((claim) => isGrounded(claim, evidence))) {
    return { ok: false, reason: "ungrounded-claim" };
  }

  let startingPoint: StartingPoint | null = null;

  if (output.startingPointReleaseId !== null) {
    const match = input.allowedReleases.find(
      (release) => release.releaseId === output.startingPointReleaseId,
    );

    if (!match) {
      return { ok: false, reason: "unknown-release" };
    }

    startingPoint = match;
  }

  return {
    ok: true,
    explanation: {
      source: "ai",
      summary: output.explanation.slice(0, MAX_SUMMARY_LENGTH),
      sharedCharacteristics: output.sharedCharacteristics,
      contrast: output.contrast,
      startingPoint,
      groundedIn: output.groundedIn,
      confidence: output.confidence,
      model: input.model,
    },
  };
}

export interface TemplateExplanationInput {
  readonly seedName: string;
  readonly candidateName: string;
  readonly evidence: MatchEvidence;
}

/**
 * The deterministic explanation.
 *
 * It describes the *relationship record* — who reported it, how strongly, and
 * which tags overlap — and explicitly declines to describe the music. That
 * restraint is the whole point: with no supplied evidence about production or
 * performance, any sentence about how something sounds would be invention.
 */
export function buildTemplateExplanation(
  input: TemplateExplanationInput,
): DiscoveryExplanation {
  const { evidence } = input;

  const sentences: string[] = [
    `ListenBrainz places ${input.candidateName} at #${evidence.rank} of ${evidence.totalCandidates} similar artists for ${input.seedName}, at ${evidence.relativeScore}% of the strongest similarity score in this set.`,
  ];

  if (evidence.sharedTags.length > 0) {
    sentences.push(
      `MusicBrainz records both artists under ${evidence.sharedTags.join(", ")}, which is the overlap most likely to feel familiar.`,
    );
  } else if (evidence.depth === "similarity-only") {
    sentences.push(
      "Shared-tag details could not be retrieved from MusicBrainz, so this rests on similarity data alone.",
    );
  } else {
    sentences.push(
      "MusicBrainz records no tags shared with the seed artist, so the overlap is not visible in tag data.",
    );
  }

  sentences.push(
    "This states what the providers report about the relationship, not how the music sounds.",
  );

  const contrast =
    evidence.candidateOnlyTags.length > 0
      ? `MusicBrainz records ${input.candidateName} under tags ${input.seedName} does not carry: ${evidence.candidateOnlyTags.join(", ")}.`
      : null;

  return {
    source: "template",
    summary: sentences.join(" ").slice(0, MAX_SUMMARY_LENGTH),
    sharedCharacteristics: evidence.sharedTags,
    contrast,
    startingPoint: evidence.startingPoint,
    groundedIn: evidence.facts.map((fact) => fact.statement),
    // Never higher: a template asserts no interpretation to be confident about.
    confidence: "low",
    model: null,
  };
}
