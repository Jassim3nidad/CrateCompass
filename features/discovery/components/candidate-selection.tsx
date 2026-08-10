import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { ProviderAttribution } from "@/features/discovery/components/provider-attribution";
import type { ArtistSearchCandidate } from "@/types/music";

/**
 * Which artist did you mean?
 *
 * Shown even when only one result comes back. Many acts share a name, and an
 * automatic selection would bind every downstream recommendation to a guess the
 * listener never made — so canonical selection is always an explicit act.
 */
export function CandidateSelection({
  query,
  candidates,
  selectedMbid,
}: {
  readonly query: string;
  readonly candidates: readonly ArtistSearchCandidate[];
  readonly selectedMbid: string | null;
}) {
  return (
    <section aria-labelledby="candidate-heading" className="space-y-4">
      <div>
        {/* Built as one string rather than interleaved JSX expressions: split
            across text nodes, the accessible name came out as "3 matchesfor". */}
        <h2
          id="candidate-heading"
          className="text-lg font-semibold tracking-[-0.02em] text-[var(--foreground)]"
        >
          {`${candidates.length} ${candidates.length === 1 ? "match" : "matches"} for “${query}”`}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
          Choose the canonical artist. Disambiguation, type, and country come
          from MusicBrainz.
        </p>
      </div>

      <ul className="space-y-2">
        {candidates.map((candidate) => {
          const isSelected = candidate.mbid === selectedMbid;

          return (
            <li key={candidate.mbid}>
              <Link
                href={`/discover?q=${encodeURIComponent(query)}&artist=${candidate.mbid}`}
                aria-current={isSelected ? "true" : undefined}
                className={`group focus-ring flex items-center justify-between gap-4 rounded-[var(--radius-md)] border p-4 transition-colors ${
                  isSelected
                    ? "border-[color-mix(in_srgb,var(--violet)_55%,var(--border))] bg-[color-mix(in_srgb,var(--violet)_14%,var(--surface))]"
                    : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-[var(--foreground)]">
                    {candidate.name}
                  </span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">
                    {[
                      candidate.disambiguation,
                      candidate.type,
                      candidate.country,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No disambiguation recorded"}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-5 shrink-0 text-[var(--muted-dim)] transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                />
              </Link>
            </li>
          );
        })}
      </ul>

      <ProviderAttribution
        sources={[{ label: "MusicBrainz", url: "https://musicbrainz.org" }]}
      />
    </section>
  );
}
