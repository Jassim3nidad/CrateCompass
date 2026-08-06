import type { TimelineEntry } from "@/lib/discography/types";

/**
 * The vocabulary shared between the discography server actions and the
 * components that render them.
 *
 * Nothing here holds a Spotify value. The artist page resolves its Spotify link
 * separately, outside this feature.
 */

export interface AnswerCitation {
  readonly mbid: string;
  readonly title: string;
  readonly year: string | null;
  readonly sourceUrl: string | null;
}

/**
 * The two partial-state signals, carried to the interface rather than resolved
 * in the service.
 *
 * They are different failures and are reported separately: a discography can be
 * completely retrieved but truncated for one broad question, and a partial
 * retrieval can still answer a narrow question completely. Collapsing them into
 * one boolean would recreate the silent-truncation defect this phase exists to
 * avoid.
 */
export interface AnswerProvenance {
  /** False when MusicBrainz retrieval stopped at the page bound. */
  readonly retrievalComplete: boolean;
  /** True when the 200-release context bound cut this question's selection. */
  readonly contextTruncated: boolean;
  readonly totalAvailable: number;
  readonly consultedCount: number;
}

export type AskResult =
  | {
      readonly status: "answered";
      readonly answer: string;
      readonly citations: readonly AnswerCitation[];
      readonly provenance: AnswerProvenance;
    }
  | {
      /** The honest limitation response, and a first-class success. */
      readonly status: "insufficient-context";
      readonly reason: string;
      readonly provenance: AnswerProvenance;
    }
  | { readonly status: "auth-required"; readonly message: string }
  | { readonly status: "limit-reached"; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

export function toCitation(entry: TimelineEntry): AnswerCitation {
  return {
    mbid: entry.mbid,
    title: entry.title,
    year: entry.firstReleaseDate.value?.slice(0, 4) ?? null,
    sourceUrl: entry.sourceUrl,
  };
}
