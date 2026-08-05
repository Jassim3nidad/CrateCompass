import type {
  DiscoveryCandidate,
  DiscoveryExplanation,
  MatchEvidence,
} from "@/lib/discovery/types";
import type {
  DiscoveryFailure,
  ExplanationStatus,
} from "@/features/discovery/service";

/**
 * The vocabulary shared between server actions and the client components that
 * call them.
 *
 * Every outcome is a named member of a closed union, including the ones that
 * are not errors — `auth-required` and `already-saved` are ordinary results a
 * public page must render, not exceptions. Nothing here can hold a Spotify
 * value; linking is a separate action with its own state type.
 */

export type SaveStatus =
  "idle" | "saved" | "already-saved" | "removed" | "auth-required" | "error";

export interface SaveState {
  readonly status: SaveStatus;
  readonly message: string;
}

export type DismissStatus =
  "idle" | "dismissed" | "restored" | "auth-required" | "error";

export interface DismissState {
  readonly status: DismissStatus;
  readonly message: string;
}

export type ExplanationResult =
  | {
      readonly status: "ready";
      readonly evidence: MatchEvidence;
      readonly explanation: DiscoveryExplanation;
      readonly source: ExplanationStatus;
      /**
       * What the configured provider does with the listener's own words, when
       * that needs saying. Computed server-side: `AI_PROVIDER` is not public
       * configuration and must not reach the browser.
       */
      readonly inputDisclosure: string | null;
    }
  | {
      readonly status: "failed";
      readonly failure: DiscoveryFailure;
      readonly message: string;
    };

export type LoadMoreResult =
  | {
      readonly status: "ready";
      readonly candidates: readonly DiscoveryCandidate[];
      readonly hasMore: boolean;
      readonly nextOffset: number;
    }
  | {
      readonly status: "failed";
      readonly failure: DiscoveryFailure;
      readonly message: string;
    };

/**
 * Plain-language wording for each reason an explanation is the deterministic
 * template. Shown to the listener, so the difference between "the model is
 * unavailable" and "the model's answer was not supported by the evidence" is
 * visible rather than hidden behind one generic message.
 */
export const EXPLANATION_SOURCE_NOTES: Record<ExplanationStatus, string> = {
  ai: "Written from the evidence above and checked against it.",
  "template-anonymous":
    "Sign in to have this evidence written up. This summary is generated from the provider records themselves.",
  "template-unavailable":
    "The writing step is unavailable right now, so this summary comes straight from the provider records.",
  "template-rejected":
    "The written version made a claim the evidence did not support, so it was discarded in favour of the provider records.",
  "template-limit-reached":
    "You have reached today's limit for AI-assisted requests. This summary comes straight from the provider records.",
  "template-blocked":
    "The written version was blocked by a safety check, so this summary comes straight from the provider records.",
};
