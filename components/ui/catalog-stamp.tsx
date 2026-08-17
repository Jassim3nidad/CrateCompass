import { cn } from "@/lib/utils";

/**
 * The one signature element, spent in one place: a printed accession stamp
 * for the canonical identifiers CrateCompass already carries (an MBID, a
 * retrieval date) but has never shown as text anywhere in the UI. Everything
 * else about the interface is soft and extruded; this is deliberately the
 * opposite — flat, ruled, monospace — because it is meant to read as ink on
 * an index card, not as another neumorphic surface.
 *
 * `border-double` is a single CSS declaration that draws two parallel rules
 * with a gap, which is the actual library-card reference rather than an
 * approximation of it — no second element or box-shadow layer needed.
 *
 * Used in exactly two places (ArtistHeader, DiscoveryCard) in exactly one
 * position (trailing the card's content, right-aligned) — see G.4 in the
 * design proposal for why consistency and restraint are the point.
 */
export function CatalogStamp({
  entries,
  className,
}: {
  readonly entries: readonly {
    readonly label: string;
    readonly value: string;
    readonly href?: string | null;
    readonly title?: string;
  }[];
  readonly className?: string;
}) {
  const visible = entries.filter((entry) => entry.value.length > 0);

  if (visible.length === 0) {
    return null;
  }

  return (
    <dl
      className={cn(
        "mt-5 flex flex-wrap justify-end gap-x-4 gap-y-1 border-t-[3px] border-double border-[var(--border-strong)] pt-2 font-mono text-[11px] leading-tight",
        className,
      )}
    >
      {visible.map((entry) => (
        <div key={entry.label} className="flex items-baseline gap-1.5">
          <dt className="tracking-[0.1em] text-[var(--muted-dim)] uppercase">
            {entry.label}
          </dt>
          <dd className="text-[var(--muted)]" title={entry.title}>
            {entry.href ? (
              <a
                href={entry.href}
                target="_blank"
                rel="noreferrer noopener"
                className="focus-ring rounded hover:text-[var(--foreground)]"
              >
                {entry.value}
              </a>
            ) : (
              entry.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
