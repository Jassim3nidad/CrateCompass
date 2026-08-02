import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-6 border-b border-[var(--border)] pb-8 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        <p className="mb-3 text-xs font-bold tracking-[0.2em] text-[var(--amber-soft)] uppercase">
          {eyebrow}
        </p>
        <h1 className="font-display text-4xl leading-[1.02] tracking-[-0.045em] text-balance text-[var(--foreground)] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)] sm:text-lg">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
