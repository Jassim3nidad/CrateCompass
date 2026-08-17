import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  TriangleAlert,
} from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { ProviderAvailability } from "@/types/provider";

const icons = {
  available: CircleCheck,
  "not-configured": CircleDashed,
  unavailable: CircleAlert,
  degraded: TriangleAlert,
} satisfies Record<ProviderAvailability, typeof CircleCheck>;

export function ProviderStatus({
  name,
  status,
  description,
}: {
  readonly name: string;
  readonly status: ProviderAvailability;
  readonly description: string;
}) {
  const Icon = icons[status];
  const label = status.replace("-", " ");

  return (
    // Nested inside a raised Card (settings page) — sunken, never a second
    // raised surface stacked on the first.
    <div className="surface-sunken elev-inset flex items-start justify-between gap-4 rounded-[var(--r-md)] p-4">
      <div className="flex min-w-0 gap-3">
        <Icon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-[var(--muted)]"
        />
        <div>
          <p className="font-semibold text-[var(--foreground)]">{name}</p>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {description}
          </p>
        </div>
      </div>
      <StatusBadge status={status} className="shrink-0 capitalize">
        {label}
      </StatusBadge>
    </div>
  );
}
