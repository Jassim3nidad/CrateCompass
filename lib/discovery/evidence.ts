import type { EvidenceFact } from "@/lib/ai/provider";
import type {
  MatchEvidence,
  MatchStrength,
  StartingPoint,
} from "@/lib/discovery/types";
import type {
  ArtistCandidate,
  CanonicalArtist,
  DiscographyRelease,
  SourceAttribution,
} from "@/types/music";

/**
 * Deterministic match evidence.
 *
 * This module is pure and does no I/O, which is the point: the facts an
 * explanation rests on are reproducible from their inputs, so a rendered
 * explanation can always be traced back to provider records rather than to a
 * model's memory. AI is never consulted here.
 *
 * Only MusicBrainz and ListenBrainz material enters. Both are on the
 * AI-approved provenance list (`AI_APPROVED_PROVENANCE`), so every fact this
 * produces is eligible to travel to the AI layer — and nothing else is
 * reachable from here, because the function signature admits nothing else.
 */

/** Bounded by `explainArtistMatchInputSchema`, which accepts at most 12 facts. */
const MAX_FACTS = 12;
const MAX_SHARED_TAGS = 6;
const MAX_CANDIDATE_ONLY_TAGS = 4;
const MAX_STATEMENT_LENGTH = 400;

const STRONG_THRESHOLD = 0.5;
const MODERATE_THRESHOLD = 0.2;

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

/** Tags and genres are one vocabulary for matching; MusicBrainz splits them. */
function tagVocabulary(artist: CanonicalArtist | null): Map<string, string> {
  const vocabulary = new Map<string, string>();

  for (const value of [...(artist?.genres ?? []), ...(artist?.tags ?? [])]) {
    const key = normalizeTag(value);
    if (key.length > 0 && !vocabulary.has(key)) {
      vocabulary.set(key, value.trim());
    }
  }

  return vocabulary;
}

export function classifyStrength(relativeScore: number): MatchStrength {
  if (relativeScore >= STRONG_THRESHOLD) return "strong";
  if (relativeScore >= MODERATE_THRESHOLD) return "moderate";
  return "emerging";
}

/**
 * The candidate's earliest studio album.
 *
 * Restricted to `Album` with no secondary type, because "start here" is only
 * meaningful for a studio record — a compilation or live album is a poor
 * introduction, and a remix release is misleading. When MusicBrainz records no
 * dated studio album there is no starting point, and the UI says so rather
 * than substituting something weaker.
 */
export function selectStartingPoint(
  releases: readonly DiscographyRelease[],
): StartingPoint | null {
  const studioAlbums = releases.filter(
    (release) =>
      release.primaryType === "Album" &&
      release.secondaryTypes.length === 0 &&
      release.firstReleaseDate.value !== null,
  );

  if (studioAlbums.length === 0) {
    return null;
  }

  // Date strings are ISO-prefixed, so lexicographic order is chronological
  // order even across mixed precisions ("1994" sorts before "1994-08-22").
  const earliest = studioAlbums.reduce((best, release) =>
    (release.firstReleaseDate.value ?? "") < (best.firstReleaseDate.value ?? "")
      ? release
      : best,
  );

  return {
    releaseId: earliest.mbid,
    title: earliest.title,
    year: earliest.firstReleaseDate.value?.slice(0, 4) ?? null,
    primaryType: earliest.primaryType,
    sourceUrl: earliest.attribution.sourceUrl,
  };
}

function fact(
  source: "musicbrainz" | "listenbrainz",
  statement: string,
): EvidenceFact {
  return { source, statement: statement.slice(0, MAX_STATEMENT_LENGTH) };
}

export interface BuildMatchEvidenceInput {
  readonly seed: CanonicalArtist;
  readonly candidate: ArtistCandidate;
  /** Null when MusicBrainz enrichment failed or has not been requested. */
  readonly candidateArtist: CanonicalArtist | null;
  readonly candidateReleases: readonly DiscographyRelease[];
  readonly rank: number;
  readonly totalCandidates: number;
  /** Highest score in the same result set, used for the relative bucket. */
  readonly topScore: number;
  readonly similarityAttribution: SourceAttribution;
}

export function buildMatchEvidence(
  input: BuildMatchEvidenceInput,
): MatchEvidence {
  const relativeScore =
    input.topScore > 0
      ? Math.max(0, Math.min(1, input.candidate.score / input.topScore))
      : 0;
  const relativePercent = Math.round(relativeScore * 100);
  const strength = classifyStrength(relativeScore);

  const seedTags = tagVocabulary(input.seed);
  const candidateTags = tagVocabulary(input.candidateArtist);

  const sharedTags: string[] = [];
  const candidateOnlyTags: string[] = [];

  for (const [key, display] of candidateTags) {
    if (seedTags.has(key)) {
      if (sharedTags.length < MAX_SHARED_TAGS) sharedTags.push(display);
    } else if (candidateOnlyTags.length < MAX_CANDIDATE_ONLY_TAGS) {
      candidateOnlyTags.push(display);
    }
  }

  const sharedType =
    input.candidateArtist?.type &&
    input.candidateArtist.type === input.seed.type
      ? input.seed.type
      : null;
  const sharedCountry =
    input.candidateArtist?.country &&
    input.candidateArtist.country === input.seed.country
      ? input.seed.country
      : null;

  const startingPoint = selectStartingPoint(input.candidateReleases);
  const depth = input.candidateArtist === null ? "similarity-only" : "full";

  const facts: EvidenceFact[] = [
    fact(
      "listenbrainz",
      `ListenBrainz ranks ${input.candidate.name} #${input.rank} of ${input.totalCandidates} similar artists for ${input.seed.name}, at ${relativePercent}% of the strongest similarity score in this result set.`,
    ),
  ];

  if (sharedTags.length > 0) {
    facts.push(
      fact(
        "musicbrainz",
        `MusicBrainz records both ${input.seed.name} and ${input.candidate.name} under the tags: ${sharedTags.join(", ")}.`,
      ),
    );
  }

  if (candidateOnlyTags.length > 0) {
    facts.push(
      fact(
        "musicbrainz",
        `MusicBrainz records ${input.candidate.name} under tags that ${input.seed.name} does not carry: ${candidateOnlyTags.join(", ")}.`,
      ),
    );
  }

  if (sharedType) {
    facts.push(
      fact(
        "musicbrainz",
        `MusicBrainz lists both artists as artist type ${sharedType}.`,
      ),
    );
  }

  if (sharedCountry) {
    facts.push(
      fact(
        "musicbrainz",
        `MusicBrainz associates both artists with country code ${sharedCountry}.`,
      ),
    );
  }

  if (startingPoint) {
    facts.push(
      fact(
        "musicbrainz",
        `MusicBrainz lists "${startingPoint.title}"${startingPoint.year ? ` (${startingPoint.year})` : ""} as the earliest studio album credited to ${input.candidate.name}, release-group id ${startingPoint.releaseId}.`,
      ),
    );
  }

  if (input.candidate.disambiguation) {
    facts.push(
      fact(
        "musicbrainz",
        `MusicBrainz describes ${input.candidate.name} as: ${input.candidate.disambiguation}.`,
      ),
    );
  }

  const attributions: SourceAttribution[] = [input.similarityAttribution];
  if (input.candidateArtist) {
    attributions.push(input.candidateArtist.attribution);
  }

  return {
    rank: input.rank,
    totalCandidates: input.totalCandidates,
    strength,
    relativeScore: relativePercent,
    sharedTags,
    candidateOnlyTags,
    sharedType,
    sharedCountry,
    startingPoint,
    depth,
    facts: facts.slice(0, MAX_FACTS),
    attributions,
  };
}
