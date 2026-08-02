import type { ProviderAvailability } from "@/types/provider";

import { cn } from "@/lib/utils";

const statusClasses: Record<ProviderAvailability, string> = {
  available:
    "border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-[var(--success-soft)]",
  "not-configured":
    "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]",
  unavailable:
    "border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger-soft)]",
  degraded:
    "border-[color-mix(in_srgb,var(--amber)_35%,transparent)] bg-[color-mix(in_srgb,var(--amber)_10%,transparent)] text-[var(--amber-soft)]",
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
        "inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold",
        statusClasses[status],
        className,
      )}
    >
      {children}
    </span>
  );
}
