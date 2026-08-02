import { ArchiveX } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function EmptyState({
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
      variant="quiet"
      className="flex min-h-72 flex-col items-center justify-center text-center"
    >
      <span className="mb-5 grid size-12 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]">
        <ArchiveX aria-hidden="true" className="size-5" />
      </span>
      <h2 className="text-xl font-semibold tracking-[-0.025em] text-[var(--foreground)]">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}
