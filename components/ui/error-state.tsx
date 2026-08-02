import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function ErrorState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <Card
      role="alert"
      className="border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_7%,var(--surface))]"
    >
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-[var(--danger-soft)]">
          <CircleAlert aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold text-[var(--foreground)]">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {description}
          </p>
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </Card>
  );
}
