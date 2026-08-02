import { Construction } from "lucide-react";

export function PhaseNotice({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--amber)_30%,var(--border))] bg-[color-mix(in_srgb,var(--amber)_7%,var(--surface))] p-4 text-sm leading-6 text-[var(--muted)]"
    >
      <Construction
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-[var(--amber-soft)]"
      />
      <p>{children}</p>
    </div>
  );
}
