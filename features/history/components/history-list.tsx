"use client";

import {
  Compass,
  ListMusic,
  MessageCircleQuestion,
  Trash2,
} from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  deleteAllHistoryAction,
  deleteHistoryEntryAction,
} from "@/features/history/actions";
import type { HistoryEntry, HistoryKind } from "@/features/history/repository";

/**
 * The history list.
 *
 * Deletion here has no undo, deliberately: an audit trail a listener chose to
 * erase should not be recoverable by the product that was told to erase it. The
 * copy says so before the click rather than after.
 */

const KIND_LABEL: Readonly<Record<HistoryKind, string>> = {
  artist: "Artist search",
  mood: "Mood",
  discography: "Discography questions",
};

function KindIcon({ kind }: { readonly kind: HistoryKind }) {
  const className = "size-4 shrink-0 text-[var(--muted)]";

  if (kind === "mood")
    return <ListMusic aria-hidden="true" className={className} />;
  if (kind === "discography")
    return <MessageCircleQuestion aria-hidden="true" className={className} />;

  return <Compass aria-hidden="true" className={className} />;
}

export function HistoryList({
  initialEntries,
  total,
}: {
  readonly initialEntries: readonly HistoryEntry[];
  readonly total: number;
}) {
  const [entries, setEntries] =
    useState<readonly HistoryEntry[]>(initialEntries);
  const [announcement, setAnnouncement] = useState("");
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [pending, startTransition] = useTransition();

  function removeEntry(id: string) {
    startTransition(async () => {
      const result = await deleteHistoryEntryAction({ id });

      if (result.ok) {
        setEntries((current) => current.filter((entry) => entry.id !== id));
      }

      setAnnouncement(result.message);
    });
  }

  function removeAll() {
    startTransition(async () => {
      const result = await deleteAllHistoryAction();
      setEntries([]);
      setConfirmingAll(false);
      setAnnouncement(result.message);
    });
  }

  return (
    <div className="space-y-4">
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {entries.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">
            {total} {total === 1 ? "entry" : "entries"} recorded.
          </p>

          {confirmingAll ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[var(--amber-soft)]">
                Delete all {total} {total === 1 ? "entry" : "entries"}? This
                cannot be undone.
              </p>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={removeAll}
                disabled={pending}
              >
                Delete everything
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setConfirmingAll(false)}
                disabled={pending}
              >
                Keep it
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setConfirmingAll(true)}
              disabled={pending}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete all history
            </Button>
          )}
        </div>
      ) : null}

      {/* A hairline-divided list, not a stack of cards: an audit trail reads
          as an index (typographic rhythm, rules between entries), and a
          shadow per row stopped meaning anything once every row had one —
          this is the "flat rows" case, not the "routine card" one --elev-flat
          already covers elsewhere (see card.tsx). */}
      <ul className="divide-y divide-[var(--border)]">
        {entries.map((entry) => (
          <li key={entry.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.15em] text-[var(--muted-dim)] uppercase">
                  <KindIcon kind={entry.kind} />
                  {KIND_LABEL[entry.kind]}
                  {entry.status === "failed" ? " · did not complete" : ""}
                </p>

                <h2 className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                  {entry.inputValue}
                </h2>

                <p className="mt-1 text-sm text-[var(--muted)]">
                  {new Date(entry.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  {entry.kind === "discography" && entry.questionCount > 0
                    ? ` · ${entry.questionCount} question${entry.questionCount === 1 ? "" : "s"}`
                    : ""}
                  {entry.kind === "artist" && entry.resultCount > 0
                    ? ` · ${entry.resultCount} candidate${entry.resultCount === 1 ? "" : "s"}`
                    : ""}
                  {entry.providers.length > 0
                    ? ` · via ${entry.providers.join(", ")}`
                    : ""}
                </p>

                {entry.playlistUrl ? (
                  <p className="mt-2 text-xs text-[var(--muted-dim)]">
                    A playlist was created in Spotify. Deleting this entry does
                    not remove it from your Spotify account.
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => removeEntry(entry.id)}
                disabled={pending}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                Delete
                <span className="sr-only"> {entry.inputValue}</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
