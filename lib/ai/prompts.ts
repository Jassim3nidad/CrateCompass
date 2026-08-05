import type { z } from "zod";

import type { explainArtistMatchInputSchema } from "@/lib/ai/schemas";

/**
 * Prompts shared by every adapter.
 *
 * The artist-match prompt lives here rather than being copied into each
 * adapter because its wording is a compliance surface: the instruction not to
 * invent a release, and the instruction to cite only supplied identifiers, must
 * be identical whichever provider is configured. Four copies would drift.
 *
 * The prompt is not the enforcement. Grounding and release identifiers are
 * verified after the model answers (`lib/discovery/explanation.ts`); this text
 * only makes the expected answer likelier.
 */

export const EXPLANATION_SYSTEM = `You explain why two artists may be related, using only the supplied evidence.
Every claim must trace to a supplied fact; list the facts you used in groundedIn.
Never assert a collaboration, release, biographical detail, or production quality that is not in the evidence.
Distinguish what the evidence states from how you interpret it, and never claim certainty.
Put concrete shared characteristics in sharedCharacteristics, and what meaningfully differs in contrast.
For startingPointReleaseId, use only an id from the supplied releases, or null when none is supplied or none fits.
Never invent an id, a title, or a release date.`;

type ExplainArtistMatchPayload = z.infer<typeof explainArtistMatchInputSchema>;

export function explainArtistMatchUserContent(
  safe: ExplainArtistMatchPayload,
): string {
  const evidence = safe.evidence
    .map((fact) => `- [${fact.source}] ${fact.statement}`)
    .join("\n");

  const releases =
    safe.candidateReleases.length > 0
      ? safe.candidateReleases
          .map(
            (release) =>
              `- id=${release.id} | ${release.title} | ${release.primaryType ?? "unknown type"} | ${release.year ?? "year unknown"}`,
          )
          .join("\n")
      : "- none supplied";

  const preference = safe.listenerPreference
    ? `\n\nWhat the listener said they like:\n${safe.listenerPreference}`
    : "";

  return `Seed artist: ${safe.seedArtistName}\nCandidate artist: ${safe.candidateArtistName}${preference}\n\nEvidence:\n${evidence}\n\nSupplied releases for the candidate:\n${releases}`;
}
