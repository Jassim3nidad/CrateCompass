import type { ProviderAvailability } from "@/types/provider";

import { cn } from "@/lib/utils";

// Badges are always nested (inside a card, a row, a result item), so — per
// the nesting rule — no raised-family shadow, not even --elev-flat. A flat
// tinted chip, border removed.
const statusClasses: Record<ProviderAvailability, string> = {
  available:
    "bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success-soft)]",
  "not-configured": "bg-[var(--surface-subtle)] text-[var(--muted)]",
  unavailable:
    "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger-soft)]",
  degraded:
    "bg-[color-mix(in_srgb,var(--amber)_10%,transparent)] text-[var(--amber-soft)]",
};

export function StatusBadge({
  status,
  children,
  className,
}: {
  readonly status: ProviderAvailability;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold",
        statusClasses[status],
        className,
      )}
    >
      {children}
    </span>
  );
}
