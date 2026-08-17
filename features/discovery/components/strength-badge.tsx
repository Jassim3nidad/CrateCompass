import type { MatchStrength } from "@/lib/discovery/types";

import { cn } from "@/lib/utils";

/**
 * The provider's similarity, bucketed.
 *
 * The visible label says "within this set" because that is the only honest
 * reading: ListenBrainz scores are unnormalised and vary by seed artist, so a
 * bucket describes a candidate's position among its peers, not an absolute
 * measure of how alike two artists are.
 */

// Always nested inside a DiscoveryCard — flat, no raised-family shadow.
const styles: Record<MatchStrength, string> = {
  strong:
    "bg-[color-mix(in_srgb,var(--violet)_16%,transparent)] text-[#c3b4ff]",
  moderate:
    "bg-[color-mix(in_srgb,var(--electric)_12%,transparent)] text-[#a8d2f0]",
  emerging: "bg-[var(--surface-subtle)] text-[var(--muted)]",
};

const labels: Record<MatchStrength, string> = {
  strong: "Strong link",
  moderate: "Moderate link",
  emerging: "Outer edge",
};

export function StrengthBadge({
  strength,
  relativeScore,
  className,
}: {
  readonly strength: MatchStrength;
  readonly relativeScore: number;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold",
        styles[strength],
        className,
      )}
    >
      <span>{labels[strength]}</span>
      <span className="sr-only">
        , {relativeScore}% of the strongest similarity score within this result
        set
      </span>
      {/* No opacity here: dimming the figure dropped it below the AA contrast
          threshold against the badge's own background. */}
      <span aria-hidden="true" className="ml-1.5 font-mono">
        {relativeScore}%
      </span>
    </span>
  );
}
