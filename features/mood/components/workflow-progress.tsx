"use client";

import { Check, Loader2 } from "lucide-react";

/**
 * Staged progress for the mood workflow.
 *
 * Each stage corresponds to a server action that is actually in flight, so the
 * label is a statement of fact rather than an animation pretending to know. The
 * two slow stages say *why* they are slow — MusicBrainz allows one request per
 * second, and a twelve-artist playlist needs roughly two lookups per artist, so
 * a silent spinner reads as a hang.
 *
 * Deliberately not a percentage: nothing here can honestly estimate completion,
 * and a bar that jumps from 20% to 90% is worse than no bar.
 */

export type WorkflowStage =
  | "idle"
  | "interpreting"
  | "seeds-ready"
  | "building"
  | "draft-ready"
  | "creating"
  | "done";

interface StageDescriptor {
  readonly id: WorkflowStage;
  readonly label: string;
  readonly detail: string;
}

const STAGES: readonly StageDescriptor[] = [
  {
    id: "interpreting",
    label: "Interpreting your description",
    detail:
      "Your words are parsed into criteria, then matched to MusicBrainz tags.",
  },
  {
    id: "building",
    label: "Finding tracks",
    detail:
      "MusicBrainz allows one request per second, so a longer playlist takes a moment. Nothing is being guessed while you wait.",
  },
  {
    id: "creating",
    label: "Building the playlist in Spotify",
    detail:
      "Each track is matched on Spotify first, then the playlist is created and filled.",
  },
];

/** Stages that have already completed by the time we reach the given stage. */
const COMPLETED_BEFORE: Record<WorkflowStage, readonly WorkflowStage[]> = {
  idle: [],
  interpreting: [],
  "seeds-ready": ["interpreting"],
  building: ["interpreting"],
  "draft-ready": ["interpreting", "building"],
  creating: ["interpreting", "building"],
  done: ["interpreting", "building", "creating"],
};

export function WorkflowProgress({ stage }: { readonly stage: WorkflowStage }) {
  if (stage === "idle") {
    return null;
  }

  const completed = new Set(COMPLETED_BEFORE[stage]);
  const active = STAGES.find((entry) => entry.id === stage);

  return (
    <ol
      // Announced as a whole when the active stage changes, so a screen-reader
      // user is told which step is running rather than only that something is.
      aria-live="polite"
      className="surface-raised elev-raised space-y-3 rounded-[var(--r-md)] p-4"
    >
      {STAGES.map((entry, index) => {
        const isDone = completed.has(entry.id);
        const isActive = entry.id === stage;
        const isLast = index === STAGES.length - 1;

        return (
          <li key={entry.id} className="flex gap-3">
            {/* The marker column doubles as the connector: a rail between the
                steps that fills as each one completes, so progress is legible
                from the shape of the list and not only from its icons. */}
            <span className="flex shrink-0 flex-col items-center">
              <span className="mt-0.5 block">
                {isDone ? (
                  // Keyed on the state, so React swaps the node and the pop
                  // plays at the moment the step completes rather than on
                  // every re-render of a step that completed earlier.
                  <Check
                    key="done"
                    aria-hidden="true"
                    className="motion-confirm size-4 text-[var(--success-soft)]"
                  />
                ) : isActive ? (
                  <Loader2
                    aria-hidden="true"
                    className="size-4 animate-spin text-[var(--accent-foreground)] motion-reduce:animate-none"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="block size-4 rounded-full border border-[var(--border-strong)]"
                  />
                )}
              </span>
              {isLast ? null : (
                <span
                  aria-hidden="true"
                  className={`mt-1 w-px flex-1 transition-colors duration-[var(--duration-slow)] ease-[var(--ease-out)] motion-reduce:transition-none ${
                    isDone ? "bg-[var(--success)]" : "bg-[var(--border)]"
                  }`}
                />
              )}
            </span>

            <span className="min-w-0 pb-1">
              <span
                className={`block text-sm transition-colors duration-[var(--duration-base)] motion-reduce:transition-none ${
                  isActive
                    ? "font-semibold text-[var(--foreground)]"
                    : "text-[var(--muted)]"
                }`}
              >
                {entry.label}
                {isDone ? <span className="sr-only"> — complete</span> : null}
                {isActive ? (
                  <span className="sr-only"> — in progress</span>
                ) : null}
              </span>
              {isActive ? (
                <span className="motion-expand mt-1 block text-xs leading-5 text-[var(--muted)]">
                  {entry.detail}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}

      {active ? null : (
        <li className="text-xs text-[var(--muted-dim)]">
          Waiting for your next choice.
        </li>
      )}
    </ol>
  );
}
