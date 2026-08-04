import type {
  CanonicalArtist,
  MatchConfidence,
  SpotifyResolution,
  SpotifyResolutionMatch,
} from "@/types/music";

/**
 * Deterministic cross-provider identity matching.
 *
 * This is a product service, deliberately outside both the provider adapters
 * and the AI layer: AI must never arbitrate between conflicting Spotify
 * results. Every outcome here is reproducible from its inputs.
 *
 * The bar for `confident` is exact equality after normalisation, against the
 * canonical name or a recorded alias. Anything weaker becomes `ambiguous` and
 * requires the user to choose, or `unresolved`. There is no fuzzy threshold
 * that can silently auto-select a wrong artist — a real risk given how many
 * distinct acts share a name.
 */

const EXACT_NAME_SCORE = 1;
const ALIAS_SCORE = 0.9;
const CONFIDENT_THRESHOLD = ALIAS_SCORE;

/**
 * Casefold, strip diacritics, drop a leading article, and collapse punctuation
 * so that "Björk", "bjork" and "BJORK" compare equal, and "The Beatles"
 * matches "Beatles".
 */
export function normalizeArtistName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/u, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface ScoredMatch {
  readonly match: SpotifyResolutionMatch;
  readonly score: number;
}

function scoreCandidate(
  canonical: CanonicalArtist,
  candidateName: string,
): number {
  const normalizedCandidate = normalizeArtistName(candidateName);

  if (normalizedCandidate.length === 0) {
    return 0;
  }

  if (normalizeArtistName(canonical.name) === normalizedCandidate) {
    return EXACT_NAME_SCORE;
  }

  const aliasHit = canonical.aliases.some(
    (alias) => normalizeArtistName(alias.name) === normalizedCandidate,
  );

  return aliasHit ? ALIAS_SCORE : 0;
}

export interface SpotifyArtistOption {
  readonly id: string;
  readonly uri: string;
  readonly name: string;
}

export function resolveSpotifyArtist(input: {
  readonly canonical: CanonicalArtist;
  readonly options: readonly SpotifyArtistOption[];
}): SpotifyResolution {
  const scored: ScoredMatch[] = input.options.map((option) => ({
    match: {
      spotifyId: option.id,
      spotifyUri: option.uri,
      name: option.name,
      matchScore: scoreCandidate(input.canonical, option.name),
    },
    score: scoreCandidate(input.canonical, option.name),
  }));

  const qualifying = scored
    .filter((entry) => entry.score >= CONFIDENT_THRESHOLD)
    .sort((first, second) => second.score - first.score);

  if (qualifying.length === 0) {
    return unresolved(
      input.options.length === 0
        ? "Spotify returned no candidates for this artist."
        : "No Spotify result matched the canonical artist name or any known alias.",
      scored.map((entry) => entry.match),
    );
  }

  const best = qualifying[0];
  if (!best) {
    return unresolved("No Spotify result could be scored.", []);
  }

  // A tie at the top means two Spotify artists are equally good matches by
  // name alone. Picking either would be a guess, so the user decides.
  const tied = qualifying.filter((entry) => entry.score === best.score);

  if (tied.length > 1) {
    return {
      confidence: "ambiguous" satisfies MatchConfidence,
      selected: null,
      alternatives: tied.map((entry) => entry.match),
      reason: `${tied.length} Spotify artists match this name equally well. Choose the intended one.`,
    };
  }

  return {
    confidence: "confident",
    selected: best.match,
    alternatives: qualifying.slice(1).map((entry) => entry.match),
    reason:
      best.score === EXACT_NAME_SCORE
        ? "Exact match on the canonical MusicBrainz artist name."
        : "Exact match on a recorded MusicBrainz alias.",
  };
}

function unresolved(
  reason: string,
  alternatives: readonly SpotifyResolutionMatch[],
): SpotifyResolution {
  return {
    confidence: "unresolved",
    selected: null,
    // Surfaced so the UI can offer manual selection, never auto-applied.
    alternatives,
    reason,
  };
}

/**
 * Similar-artist candidates from ListenBrainz already carry MBIDs, so matching
 * them to a canonical artist is identifier equality rather than name
 * comparison. Kept explicit so the guarantee is visible and testable.
 */
export function matchesCanonicalArtist(
  canonicalMbid: string,
  candidateMbid: string | null,
): boolean {
  return candidateMbid !== null && candidateMbid === canonicalMbid;
}
