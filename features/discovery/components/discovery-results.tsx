"use client";

import { Undo2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  dismissDiscoveryAction,
  loadMoreCandidatesAction,
  restoreDiscoveryAction,
} from "@/features/discovery/actions";
import { DiscoveryCard } from "@/features/discovery/components/discovery-card";
import { ProviderAttribution } from "@/features/discovery/components/provider-attribution";
import type { DiscoveryCandidate } from "@/lib/discovery/types";

/**
 * The result list.
 *
 * Dismissal is optimistic — the card leaves immediately — but reversible, and
 * the undo control receives focus so a keyboard user is not stranded where a
 * card used to be. If the write fails, the card comes back and the failure is
 * announced rather than silently swallowed.
 *
 * Rank is the provider's own position and is never renumbered after a
 * dismissal: renumbering would quietly rewrite what ListenBrainz reported.
 */
export function DiscoveryResults({
  seedMbid,
  seedName,
  initialCandidates,
  initialHasMore,
  initialNextOffset,
  attributionUrl,
}: {
  readonly seedMbid: string;
  readonly seedName: string;
  readonly initialCandidates: readonly DiscoveryCandidate[];
  readonly initialHasMore: boolean;
  readonly initialNextOffset: number;
  readonly attributionUrl: string | null;
}) {
  const [candidates, setCandidates] =
    useState<readonly DiscoveryCandidate[]>(initialCandidates);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [offset, setOffset] = useState(initialNextOffset);
  const [announcement, setAnnouncement] = useState("");
  const [undoTarget, setUndoTarget] = useState<DiscoveryCandidate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const undoRef = useRef<HTMLButtonElement>(null);

  function dismiss(candidate: DiscoveryCandidate) {
    const previous = candidates;
    setCandidates((current) =>
      current.filter((entry) => entry.mbid !== candidate.mbid),
    );

    startTransition(async () => {
      const result = await dismissDiscoveryAction({
        seedMbid,
        candidateMbid: candidate.mbid,
        candidateName: candidate.name,
      });

      if (result.status === "dismissed") {
        setUndoTarget(candidate);
        setAnnouncement(`${candidate.name} dismissed.`);
        // Focus follows the action so the keyboard position is not lost.
        requestAnimationFrame(() => undoRef.current?.focus());
        return;
      }

      setCandidates(previous);
      setUndoTarget(null);
      setAnnouncement(
        result.status === "auth-required"
          ? `${result.message} ${candidate.name} is still shown.`
          : `${candidate.name} could not be dismissed.`,
      );
    });
  }

  function undo() {
    const candidate = undoTarget;

    if (!candidate) {
      return;
    }

    startTransition(async () => {
      const result = await restoreDiscoveryAction({
        seedMbid,
        candidateMbid: candidate.mbid,
      });

      if (result.status !== "restored") {
        setAnnouncement(`${candidate.name} could not be restored.`);
        return;
      }

      setCandidates((current) =>
        [...current, candidate].sort(
          (first, second) => first.rank - second.rank,
        ),
      );
      setUndoTarget(null);
      setAnnouncement(`${candidate.name} restored.`);
    });
  }

  function loadMore() {
    setLoadError(null);

    startTransition(async () => {
      const result = await loadMoreCandidatesAction({ seedMbid, offset });

      if (result.status === "failed") {
        setLoadError(result.message);
        return;
      }

      const known = new Set(candidates.map((entry) => entry.mbid));
      const added = result.candidates.filter((entry) => !known.has(entry.mbid));

      setCandidates((current) => [...current, ...added]);
      setHasMore(result.hasMore);
      setOffset(result.nextOffset);
      setAnnouncement(`${added.length} more artists loaded.`);
    });
  }

  return (
    <div>
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {undoTarget ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
          <p className="text-sm text-[var(--muted)]">
            {undoTarget.name} dismissed for {seedName}.
          </p>
          <Button
            type="button"
            ref={undoRef}
            variant="secondary"
            size="sm"
            onClick={undo}
            disabled={pending}
          >
            <Undo2 aria-hidden="true" className="size-4" />
            Undo
            <span className="sr-only"> dismissing {undoTarget.name}</span>
          </Button>
        </div>
      ) : null}

      <ol className="space-y-4">
        {candidates.map((candidate) => (
          <li key={candidate.mbid}>
            <DiscoveryCard
              seedMbid={seedMbid}
              seedName={seedName}
              candidate={candidate}
              onDismiss={dismiss}
            />
          </li>
        ))}
      </ol>

      {loadError ? (
        <p role="alert" className="mt-4 text-sm text-[var(--danger-soft)]">
          {loadError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-4 border-t border-[var(--border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
        {hasMore ? (
          <Button
            type="button"
            variant="secondary"
            onClick={loadMore}
            disabled={pending}
          >
            {pending ? "Loading…" : "Load more artists"}
          </Button>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            That is every related artist the provider reported for {seedName}.
          </p>
        )}

        <ProviderAttribution
          sources={[
            { label: "ListenBrainz", url: attributionUrl },
            { label: "MusicBrainz", url: "https://musicbrainz.org" },
          ]}
        />
      </div>
    </div>
  );
}
