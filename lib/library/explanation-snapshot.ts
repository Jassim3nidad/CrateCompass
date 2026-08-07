import { z } from "zod";

import type { DiscoveryExplanation } from "@/lib/discovery/types";

/**
 * The explanation a listener kept, frozen at the moment they kept it.
 *
 * Stored on the favourite rather than referenced from `discovery_results`,
 * which cascades from `discovery_sessions`: pointing at it would mean clearing
 * history silently strips every saved favourite of the reasoning that caused it
 * to be saved. The duplication is deliberate — the two records answer different
 * questions and must have independent lifetimes.
 *
 * Regenerating instead was rejected. It would spend an AI request per view
 * against a tight daily cap, and it could return a *different* explanation than
 * the one that convinced someone to save. A library showing a different reason
 * than the one you kept is worse than one showing an old reason.
 *
 * `groundedIn` is deliberately absent. It is the verification trace, its job
 * finished when the explanation passed its citation check before first display,
 * and storing it would invite a later reader to re-verify against evidence that
 * no longer exists — failing for a reason that is not a defect.
 */

/**
 * Bumped whenever the stored shape changes meaning.
 *
 * The reader below tolerates a version it does not know rather than throwing,
 * because an old favourite must still render something rather than break the
 * page it sits on.
 */
export const EXPLANATION_SNAPSHOT_VERSION = 1;

const startingPointSchema = z.object({
  releaseId: z.string(),
  title: z.string(),
  year: z.string().nullable(),
  primaryType: z.string().nullable(),
  sourceUrl: z.string().nullable(),
});

const snapshotSchema = z.object({
  summary: z.string(),
  sharedCharacteristics: z.array(z.string()),
  contrast: z.string().nullable(),
  startingPoint: startingPointSchema.nullable(),
});

export type ExplanationSnapshot = z.infer<typeof snapshotSchema>;

export interface StoredExplanation {
  readonly snapshot: ExplanationSnapshot;
  readonly version: number;
  readonly source: "ai" | "template";
  readonly provider: string | null;
  readonly model: string | null;
  /** True when the stored version is newer or older than this build knows. */
  readonly versionMismatch: boolean;
}

export interface ExplanationColumns {
  readonly explanation: ExplanationSnapshot;
  readonly explanation_version: number;
  readonly explanation_source: "ai" | "template";
  readonly explanation_provider: string | null;
  readonly explanation_model: string | null;
}

/** Freezes an explanation into the columns the favourite stores. */
export function toExplanationColumns(input: {
  readonly explanation: DiscoveryExplanation;
  readonly provider: string | null;
}): ExplanationColumns {
  const source = input.explanation.source === "ai" ? "ai" : "template";

  return {
    explanation: {
      summary: input.explanation.summary,
      sharedCharacteristics: [...input.explanation.sharedCharacteristics],
      contrast: input.explanation.contrast,
      startingPoint: input.explanation.startingPoint
        ? { ...input.explanation.startingPoint }
        : null,
    },
    explanation_version: EXPLANATION_SNAPSHOT_VERSION,
    explanation_source: source,
    // The check constraint requires a provider for an AI explanation, and a
    // template one has none to name.
    explanation_provider: source === "ai" ? input.provider : null,
    explanation_model: source === "ai" ? input.explanation.model : null,
  };
}

/**
 * Reads a stored explanation back, tolerantly.
 *
 * Returns null only when there is nothing usable. A row whose version this
 * build does not recognise still renders what parses, flagged, because a
 * library that breaks on an old favourite is worse than one showing a partial
 * explanation.
 */
export function readStoredExplanation(row: {
  readonly explanation: unknown;
  readonly explanation_version: number | null;
  readonly explanation_source: string | null;
  readonly explanation_provider: string | null;
  readonly explanation_model: string | null;
}): StoredExplanation | null {
  if (row.explanation === null || row.explanation === undefined) {
    return null;
  }

  const parsed = snapshotSchema.safeParse(row.explanation);

  if (!parsed.success) {
    return null;
  }

  const version = row.explanation_version ?? 0;

  return {
    snapshot: parsed.data,
    version,
    source: row.explanation_source === "ai" ? "ai" : "template",
    provider: row.explanation_provider,
    model: row.explanation_model,
    versionMismatch: version !== EXPLANATION_SNAPSHOT_VERSION,
  };
}
