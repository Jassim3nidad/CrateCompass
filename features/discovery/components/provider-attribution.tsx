export interface AttributionSource {
  readonly label: string;
  readonly url: string | null;
}

/**
 * Source credit for externally supplied facts.
 *
 * Rendered next to the data it describes rather than once in a page footer:
 * attribution that is far from the claim it supports does not tell a reader
 * where a particular statement came from, which is the entire purpose.
 */
export function ProviderAttribution({
  sources,
  className,
}: {
  readonly sources: readonly AttributionSource[];
  readonly className?: string;
}) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <p className={className ?? "text-xs leading-5 text-[var(--muted-dim)]"}>
      Source:{" "}
      {sources.map((source, index) => (
        <span key={`${source.label}-${index}`}>
          {index > 0 ? ", " : ""}
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="focus-ring rounded underline underline-offset-2 hover:text-[var(--foreground)]"
            >
              {source.label}
            </a>
          ) : (
            source.label
          )}
        </span>
      ))}
    </p>
  );
}
