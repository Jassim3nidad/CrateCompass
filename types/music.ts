/**
 * Application-owned music domain models.
 *
 * Raw provider responses stay inside their adapter. Everything crossing into
 * product logic is one of these types, and every externally sourced fact
 * carries `provenance` so the AI boundary can decide at runtime whether it is
 * permitted to travel. See docs/architecture/provider-boundaries.md.
 */

export type Provenance =
  "musicbrainz" | "listenbrainz" | "spotify" | "user" | "application";

/**
 * Sources whose terms permit sending derived facts to an AI provider.
 *
 * Spotify is absent and must stay absent: its developer policy prohibits
 * ingesting Spotify Content into a machine-learning model. ListenBrainz is
 * present because its listen data is CC0 (ADR 0003).
 */
export const AI_APPROVED_PROVENANCE = [
  "musicbrainz",
  "listenbrainz",
  "user",
  "application",
] as const satisfies readonly Provenance[];

export type AiApprovedProvenance = (typeof AI_APPROVED_PROVENANCE)[number];

export function isAiApprovedProvenance(
  value: string,
): value is AiApprovedProvenance {
  return (AI_APPROVED_PROVENANCE as readonly string[]).includes(value);
}

/** MusicBrainz identifier. A UUID, but distinct from every other UUID we hold. */
export type MusicBrainzId = string & { readonly __brand: "MusicBrainzId" };

export function asMusicBrainzId(value: string): MusicBrainzId {
  return value as MusicBrainzId;
}

export interface SourceAttribution {
  readonly provenance: Provenance;
  /** Human-facing link to the source record, for the attribution requirement. */
  readonly sourceUrl: string | null;
  readonly retrievedAt: string;
}

export interface ArtistAlias {
  readonly name: string;
  readonly sortName: string | null;
  readonly locale: string | null;
  readonly primary: boolean;
}

export interface CanonicalArtist {
  readonly mbid: MusicBrainzId;
  readonly name: string;
  readonly sortName: string;
  /** MusicBrainz disambiguation comment, e.g. "UK trip-hop band". */
  readonly disambiguation: string | null;
  /** Person, Group, Orchestra, Choir, Character, Other, or null when unknown. */
  readonly type: string | null;
  /** ISO 3166 country code where MusicBrainz records one. */
  readonly country: string | null;
  readonly aliases: readonly ArtistAlias[];
  readonly attribution: SourceAttribution;
}

/**
 * A search hit before the user has confirmed which artist they meant.
 * `searchScore` is the provider's own confidence, not ours.
 */
export interface ArtistSearchCandidate {
  readonly mbid: MusicBrainzId;
  readonly name: string;
  readonly sortName: string;
  readonly disambiguation: string | null;
  readonly type: string | null;
  readonly country: string | null;
  readonly searchScore: number | null;
  readonly attribution: SourceAttribution;
}

/** One similar artist, as reported by the discovery provider. */
export interface ArtistCandidate {
  /**
   * ListenBrainz returns MBIDs directly, so this is populated for every
   * candidate today. It stays nullable because the port must also accommodate
   * a name-only provider without changing product code.
   */
  readonly mbid: MusicBrainzId | null;
  readonly name: string;
  readonly disambiguation: string | null;
  readonly type: string | null;
  /** Provider-supplied similarity strength. Scales differ between providers. */
  readonly score: number;
  readonly attribution: SourceAttribution;
}

export interface SimilarityEvidence {
  readonly referenceMbid: MusicBrainzId;
  readonly candidates: readonly ArtistCandidate[];
  /**
   * Opaque provider tuning identifier, recorded so a result set can be
   * explained and reproduced later. See ADR 0003 on its stability.
   */
  readonly algorithm: string;
  readonly attribution: SourceAttribution;
}

export type ReleaseDatePrecision = "year" | "month" | "day" | "unknown";

/**
 * MusicBrainz records partial dates. Precision is preserved rather than padded,
 * because "1997" and "1997-01-01" are different claims.
 */
export interface PartialDate {
  readonly value: string | null;
  readonly precision: ReleaseDatePrecision;
}

export interface DiscographyRelease {
  readonly mbid: MusicBrainzId;
  readonly title: string;
  /** Album, Single, EP, Broadcast, Other, or null. */
  readonly primaryType: string | null;
  /** Compilation, Live, Remix, Soundtrack, and similar qualifiers. */
  readonly secondaryTypes: readonly string[];
  readonly firstReleaseDate: PartialDate;
  readonly disambiguation: string | null;
  readonly attribution: SourceAttribution;
}

export interface TrackCandidate {
  readonly mbid: MusicBrainzId | null;
  readonly title: string;
  readonly artistName: string;
  readonly attribution: SourceAttribution;
}

/**
 * Outcome of deterministic cross-provider matching.
 *
 * `confident` may be included automatically after user review; `ambiguous`
 * requires an explicit choice; `unresolved` stays unresolved and is never
 * silently upgraded. AI is not consulted at any point.
 */
export type MatchConfidence = "confident" | "ambiguous" | "unresolved";

export interface SpotifyResolutionMatch {
  /** Kept as plain strings here: this type is never AI-eligible regardless. */
  readonly spotifyId: string;
  readonly spotifyUri: string;
  readonly name: string;
  readonly matchScore: number;
}

export interface SpotifyResolution {
  readonly confidence: MatchConfidence;
  /** Populated only when confidence is `confident`. */
  readonly selected: SpotifyResolutionMatch | null;
  /** Populated when confidence is `ambiguous`, for user selection. */
  readonly alternatives: readonly SpotifyResolutionMatch[];
  /** Why the resolver reached this outcome, for the UI to explain. */
  readonly reason: string;
}
