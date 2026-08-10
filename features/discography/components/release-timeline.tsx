"use client";

import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { countByCategory } from "@/lib/discography/retrieval";
import {
  RELEASE_CATEGORIES,
  type Discography,
  type ReleaseCategory,
} from "@/lib/discography/types";

/**
 * The release timeline, chronological, with type filters.
 *
 * Two things this must never do, both of which are the same defect the silent
 * 25-cap truncation was: state a count that is not MusicBrainz's own, and
 * present a partial retrieval as a whole discography. The badge and caption
 * below are not decoration — they are the visible half of `retrievalComplete`,
 * and the reason that flag is carried all the way from the client rather than
 * resolved in the service.
 */

const CATEGORY_LABELS: Readonly<Record<ReleaseCategory, string>> = {
  album: "Albums",
  ep: "EPs",
  single: "Singles",
  live: "Live",
  compilation: "Compilations",
  soundtrack: "Soundtracks",
  other: "Other",
};

/** "1997", "1997-03", and "unknown" are different claims and read differently. */
function formatDate(entry: Discography["entries"][number]): string {
  const { value, precision } = entry.firstReleaseDate;

  if (!value) return "Date not recorded";
  if (precision === "year") return value;
  if (precision === "month") return value;

  return value;
}

export function ReleaseTimeline({
  discography,
}: {
  readonly discography: Discography;
}) {
  const [active, setActive] = useState<ReleaseCategory | "all">("all");

  const counts = useMemo(() => countByCategory(discography), [discography]);

  const visible = useMemo(
    () =>
      active === "all"
        ? discography.entries
        : discography.entries.filter((entry) => entry.category === active),
    [active, discography],
  );

  const available = RELEASE_CATEGORIES.filter(
    (category) => (counts[category] ?? 0) > 0,
  );

  return (
    <section aria-labelledby="discography-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id="discography-heading"
          className="font-display text-2xl tracking-[-0.02em] text-[var(--foreground)]"
        >
          Releases
        </h2>

        {discography.retrievalComplete ? null : (
          <StatusBadge status="degraded">Partial discography</StatusBadge>
        )}
      </div>

      {discography.retrievalComplete ? (
        <p className="text-sm text-[var(--muted)]">
          {discography.total.toLocaleString()} release group
          {discography.total === 1 ? "" : "s"} recorded by MusicBrainz.
        </p>
      ) : (
        <p role="status" className="text-sm leading-6 text-[var(--amber-soft)]">
          Showing {discography.entries.length.toLocaleString()} of{" "}
          {discography.total.toLocaleString()} release groups. Retrieval stopped
          at a safety limit, so this list is not complete and counts drawn from
          it would be wrong.
        </p>
      )}

      <div
        role="group"
        aria-label="Filter releases by type"
        className="flex flex-wrap gap-2"
      >
        <FilterChip
          label={`All (${discography.entries.length})`}
          selected={active === "all"}
          onSelect={() => setActive("all")}
        />
        {available.map((category) => (
          <FilterChip
            key={category}
            label={`${CATEGORY_LABELS[category]} (${counts[category]})`}
            selected={active === category}
            onSelect={() => setActive(category)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No releases of that type are recorded for this artist.
        </p>
      ) : (
        <ol className="space-y-2">
          {visible.map((entry) => (
            <li
              key={entry.mbid}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--foreground)]">
                  {entry.title}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  {CATEGORY_LABELS[entry.category]}
                  {entry.disambiguation ? ` · ${entry.disambiguation}` : ""}
                </span>
              </span>

              <span className="flex items-center gap-3 text-xs text-[var(--muted-dim)]">
                <span>{formatDate(entry)}</span>
                {entry.sourceUrl ? (
                  <a
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="focus-ring inline-flex items-center gap-1 rounded underline underline-offset-2 hover:text-[var(--foreground)]"
                  >
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    MusicBrainz
                    <span className="sr-only">
                      record for {entry.title} (opens in a new tab)
                    </span>
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function FilterChip({
  label,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "accent" : "secondary"}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {label}
    </Button>
  );
}
