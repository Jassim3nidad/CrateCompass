"use client";

import { Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  bulkRemoveAction,
  removeFavoriteAction,
  restoreFavoriteAction,
} from "@/features/library/actions";
import type { RestorableFavorite } from "@/features/library/mutations";
import type { LibraryItem } from "@/features/library/repository";
import { SORT_MODES, type SortMode } from "@/lib/library/cursor";

/**
 * The library.
 *
 * Two behaviours here are load-bearing rather than cosmetic.
 *
 * **Undo holds the removed row in this component and nowhere else.** The row is
 * genuinely deleted server-side the moment Remove is pressed; what survives is
 * a copy in browser state. Leaving the page ends the window, which the copy
 * says, and restoring inserts a *new* row with today's date, which the copy
 * also says.
 *
 * **Select-all means the rows currently loaded.** Keyset pagination has no
 * notion of the whole filtered set, and with bulk delete irreversible, an
 * unlabelled "select all" that silently meant 24 of 200 would be a trap.
 */

const SORT_LABELS: Readonly<Record<SortMode, string>> = {
  newest: "Newest first",
  oldest: "Oldest first",
  alphabetical: "A to Z",
};

const ENTITY_FILTERS = [
  { value: "all", label: "Everything" },
  { value: "artist", label: "Artists" },
  { value: "mood", label: "From moods" },
  { value: "discography", label: "From discographies" },
  { value: "manual", label: "Added by hand" },
] as const;

interface PendingUndo {
  readonly favorite: RestorableFavorite;
  readonly label: string;
}

export function LibraryBrowser({
  items,
  matching,
  total,
  vocabulary,
  search,
  sort,
  entity,
  activeTags,
}: {
  readonly items: readonly LibraryItem[];
  readonly matching: number;
  readonly total: number;
  readonly vocabulary: readonly string[];
  readonly search: string;
  readonly sort: SortMode;
  readonly entity: string;
  readonly activeTags: readonly string[];
}) {
  const router = useRouter();
  const searchId = useId();
  const [draftSearch, setDraftSearch] = useState(search);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<PendingUndo | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [pending, startTransition] = useTransition();
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The undo window. Navigating away unmounts this and the offer is gone,
  // which is the honest consequence of the row having really been deleted.
  useEffect(() => {
    if (!undo) return;

    undoTimer.current = setTimeout(() => setUndo(null), 10_000);

    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [undo]);

  function navigate(next: Record<string, string | null>) {
    const params = new URLSearchParams();

    const merged: Record<string, string | null> = {
      q: search || null,
      sort,
      type: entity === "all" ? null : entity,
      tags: activeTags.length > 0 ? activeTags.join(",") : null,
      ...next,
    };

    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }

    // Any filter change resets pagination: a cursor is only meaningful for the
    // query that produced it.
    router.push(`/library${params.size > 0 ? `?${params}` : ""}`);
  }

  function toggleTag(tag: string) {
    const next = activeTags.includes(tag)
      ? activeTags.filter((value) => value !== tag)
      : [...activeTags, tag];

    navigate({ tags: next.length > 0 ? next.join(",") : null });
  }

  function remove(item: LibraryItem) {
    startTransition(async () => {
      const result = await removeFavoriteAction({ id: item.id });

      if (result.status !== "removed") {
        setAnnouncement(result.message);
        return;
      }

      setUndo({ favorite: result.restorable, label: item.artistName });
      setAnnouncement(`${item.artistName} removed. ${result.message}`);
      router.refresh();
    });
  }

  function restore() {
    if (!undo) return;

    const pendingUndo = undo;
    setUndo(null);

    startTransition(async () => {
      const result = await restoreFavoriteAction(pendingUndo.favorite);
      setAnnouncement(result.message);
      router.refresh();
    });
  }

  function removeSelected() {
    const ids = [...selected];

    startTransition(async () => {
      const result = await bulkRemoveAction({ ids });
      setSelected(new Set());
      setConfirmingBulk(false);
      setAnnouncement(result.message);
      router.refresh();
    });
  }

  const allLoadedSelected = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-6">
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <Card variant="quiet">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <Label htmlFor={searchId}>Search your library</Label>
            <div className="mt-2 flex gap-2">
              <Input
                id={searchId}
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate({ q: draftSearch });
                }}
                placeholder="Artist, recording, or a word from a note"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate({ q: draftSearch })}
              >
                Search
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor={`${searchId}-sort`}>Sort</Label>
            <select
              id={`${searchId}-sort`}
              value={sort}
              onChange={(event) => navigate({ sort: event.target.value })}
              className="focus-ring surface-sunken elev-inset mt-2 min-h-11 w-full rounded-[var(--r-pill)] px-3 text-sm text-[var(--foreground)]"
            >
              {SORT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {SORT_LABELS[mode]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter by where it came from"
          className="mt-4 flex flex-wrap gap-2"
        >
          {ENTITY_FILTERS.map((filter) => (
            <FilterChip
              key={filter.value}
              active={entity === filter.value}
              onClick={() => navigate({ type: filter.value })}
            >
              {filter.label}
            </FilterChip>
          ))}
        </div>

        {vocabulary.length > 0 ? (
          <div
            role="group"
            aria-label="Filter by tag"
            className="mt-4 flex flex-wrap gap-2"
          >
            {vocabulary.map((tag) => (
              <FilterChip
                key={tag}
                active={activeTags.includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </FilterChip>
            ))}
            {activeTags.length > 1 ? (
              <p className="w-full text-xs text-[var(--muted-dim)]">
                Showing items with all {activeTags.length} selected tags.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      {undo ? (
        <div
          role="status"
          className="surface-raised elev-raised flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] p-4"
        >
          <p className="text-sm text-[var(--foreground)]">
            {undo.label} was removed. Adding it back creates a new entry dated
            today, and leaving this page ends the offer.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={restore}
            disabled={pending}
          >
            <Undo2 aria-hidden="true" className="size-4" />
            Undo
          </Button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">
            {matching === total
              ? `${total} ${total === 1 ? "item" : "items"}`
              : `${matching} of ${total} items match`}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                setSelected(
                  allLoadedSelected
                    ? new Set()
                    : new Set(items.map((item) => item.id)),
                )
              }
            >
              {allLoadedSelected
                ? "Clear selection"
                : `Select these ${items.length}`}
            </Button>

            {selected.size > 0 ? (
              confirmingBulk ? (
                <>
                  <p className="text-sm text-[var(--amber-soft)]">
                    Delete {selected.size}{" "}
                    {selected.size === 1 ? "item" : "items"}? This cannot be
                    undone.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={removeSelected}
                    disabled={pending}
                  >
                    Delete {selected.size}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmingBulk(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmingBulk(true)}
                >
                  Remove {selected.size} selected
                </Button>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        total === 0 ? (
          <EmptyState
            title="Nothing saved yet"
            description="Discoveries you keep will appear here, with the explanation that convinced you and any notes or tags you add."
          />
        ) : (
          <EmptyState
            title="Nothing matches those filters"
            description={`You have ${total} saved ${total === 1 ? "item" : "items"}, but none match what you have selected. Clearing a tag or the search will bring them back.`}
          />
        )
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <li key={item.id}>
              <LibraryCard
                item={item}
                selected={selected.has(item.id)}
                pending={pending}
                onToggle={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
                onRemove={() => remove(item)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A filter, not a call to action — deliberately not the shared `Button`.
 * Raised inside the search Card's `quiet` (sunken) surface would read
 * inverted, and a row of these competing as raised CTAs would drown out
 * the one control on the page that actually is one (Search). Pressed-in
 * reads as "selected" here, which is the correct language inside a well:
 * inactive is flat with no shadow, active sinks in with accent text.
 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring touch-target-sm inline-flex h-9 items-center justify-center rounded-[var(--r-pill)] px-3 text-xs font-semibold tracking-[-0.01em] transition-[background-color,box-shadow,color] duration-[var(--duration-fast)] motion-reduce:transition-none ${
        active
          ? "surface-sunken elev-inset text-[var(--accent-foreground)]"
          : "bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
    </button>
  );
}

function LibraryCard({
  item,
  selected,
  pending,
  onToggle,
  onRemove,
}: {
  readonly item: LibraryItem;
  readonly selected: boolean;
  readonly pending: boolean;
  readonly onToggle: () => void;
  readonly onRemove: () => void;
}) {
  const savedOn = new Date(item.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="size-4 accent-[var(--violet)]"
          />
          <span className="sr-only">Select {item.artistName}</span>
          {item.sourceType}
        </label>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRemove}
          disabled={pending}
        >
          <X aria-hidden="true" className="size-4" />
          Remove
          <span className="sr-only"> {item.artistName}</span>
        </Button>
      </div>

      <h2 className="mt-3 text-lg font-semibold text-[var(--foreground)]">
        {item.artistName}
      </h2>
      {item.recordingName ? (
        <p className="mt-1 text-sm text-[var(--muted)]">{item.recordingName}</p>
      ) : null}

      {item.explanation ? (
        <div className="surface-sunken elev-inset mt-4 rounded-[var(--r-md)] p-3">
          <p className="text-sm leading-6 text-[var(--foreground)]">
            {item.explanation.snapshot.summary}
          </p>
          {/* Dated, because a snapshot is not a current claim: MusicBrainz may
              have merged or retitled a release since this was written. */}
          <p className="mt-2 text-xs text-[var(--muted-dim)]">
            Saved with this discovery on {savedOn}
            {item.explanation.source === "ai" && item.explanation.model
              ? ` · written by ${item.explanation.model}`
              : " · deterministic summary"}
            {item.explanation.versionMismatch
              ? " · stored in an older format"
              : ""}
          </p>
        </div>
      ) : null}

      {item.note ? (
        <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
          {item.note}
        </p>
      ) : null}

      {item.tags.length > 0 ? (
        <ul aria-label="Tags" className="mt-4 flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-[var(--surface-subtle)] px-3 py-1 text-xs text-[var(--muted)]"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 text-xs text-[var(--muted-dim)]">Saved {savedOn}</p>
    </Card>
  );
}
