import type {
  ArtistMatchExplanation,
  DiscographyAnswer,
  MoodCriteria,
  PlaylistDescription,
  PlaylistTitle,
} from "@/lib/ai/schemas";

/**
 * Provider-neutral AI port.
 *
 * Product code depends on this interface and never imports a vendor SDK, so
 * switching providers is an environment change. Note what the input types do
 * *not* contain: there is no field on any of them that could carry a Spotify
 * identifier, URI, or payload. The boundary is expressed in the type system
 * first and enforced at runtime second (`lib/ai/gateway.ts`).
 */

export type AiProviderName = "anthropic" | "openai" | "openrouter" | "gemini";

export type AiFailureKind =
  | "not-configured"
  | "refused"
  | "invalid-output"
  | "rate-limited"
  | "quota-exceeded"
  | "timeout"
  | "unavailable";

export class AiProviderError extends Error {
  readonly kind: AiFailureKind;
  /** True when a deterministic fallback is an acceptable substitute. */
  readonly fallbackEligible: boolean;

  constructor(
    kind: AiFailureKind,
    message: string,
    options: { readonly fallbackEligible?: boolean } = {},
  ) {
    super(message);
    this.name = "AiProviderError";
    this.kind = kind;
    this.fallbackEligible = options.fallbackEligible ?? true;
  }
}

/** Sources whose terms permit their facts being sent to an AI provider. */
export type ApprovedEvidenceSource = "musicbrainz" | "listenbrainz";

export interface EvidenceFact {
  readonly source: ApprovedEvidenceSource;
  readonly statement: string;
}

export interface ParseMoodInput {
  /** The user's own words. Always permitted to enter AI. */
  readonly moodText: string;
}

export interface ExplainArtistMatchInput {
  readonly seedArtistName: string;
  readonly candidateArtistName: string;
  /** Bounded, provenance-tagged facts. Never Spotify-derived. */
  readonly evidence: readonly EvidenceFact[];
}

export interface AnswerDiscographyQuestionInput {
  readonly question: string;
  readonly artistName: string;
  /** Retrieved MusicBrainz context. The answer may use nothing else. */
  readonly releases: readonly {
    readonly id: string;
    readonly title: string;
    readonly primaryType: string | null;
    readonly firstReleaseDate: string | null;
  }[];
}

export interface GeneratePlaylistTextInput {
  readonly moodText: string;
  readonly criteria: MoodCriteria;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  parseMood(input: ParseMoodInput): Promise<MoodCriteria>;
  explainArtistMatch(
    input: ExplainArtistMatchInput,
  ): Promise<ArtistMatchExplanation>;
  answerDiscographyQuestion(
    input: AnswerDiscographyQuestionInput,
  ): Promise<DiscographyAnswer>;
  generatePlaylistTitle(
    input: GeneratePlaylistTextInput,
  ): Promise<PlaylistTitle>;
  generatePlaylistDescription(
    input: GeneratePlaylistTextInput,
  ): Promise<PlaylistDescription>;
}
