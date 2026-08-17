import { ProviderAttribution } from "@/features/discovery/components/provider-attribution";
import type { CanonicalArtist } from "@/types/music";

/**
 * Editorial header for a canonical artist.
 *
 * Everything shown here is a MusicBrainz fact. There is no artwork: Spotify's
 * policy forbids rehosting or altering its images, and MusicBrainz supplies
 * none — so the design leans on typography rather than borrowing a picture it
 * has no right to modify.
 */
export function ArtistHeader({
  artist,
  releaseCount,
  releasesComplete = true,
}: {
  readonly artist: CanonicalArtist;
  /**
   * MusicBrainz's own total, not the number of records fetched. These differed
   * silently before: the lookup subquery caps at 25, so this read "25 release
   * groups" for an artist with 573.
   */
  readonly releaseCount: number;
  readonly releasesComplete?: boolean;
}) {
  const facts = [
    artist.type,
    artist.country,
    releaseCount > 0
      ? `${releaseCount} release group${releaseCount === 1 ? "" : "s"}`
      : null,
  ].filter((value): value is string => Boolean(value));

  const tags = [...new Set([...artist.genres, ...artist.tags])].slice(0, 8);

  return (
    <header className="elev-raised rounded-[var(--r-lg)] bg-[image:linear-gradient(150deg,color-mix(in_srgb,var(--accent)_12%,var(--neu-raised)),var(--neu-raised))] p-6 sm:p-8">
      <p className="text-xs font-bold tracking-[0.2em] text-[var(--amber-soft)] uppercase">
        Canonical artist
      </p>
      <h1 className="font-display mt-3 text-4xl leading-[1.05] tracking-[-0.04em] text-balance text-[var(--foreground)] sm:text-5xl">
        {artist.name}
      </h1>
      {artist.disambiguation ? (
        <p className="mt-3 text-base leading-7 text-[var(--muted)]">
          {artist.disambiguation}
        </p>
      ) : null}

      {facts.length > 0 ? (
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--muted)]">
          {artist.type ? (
            <div className="flex gap-2">
              <dt className="text-[var(--muted-dim)]">Type</dt>
              <dd className="text-[var(--foreground)]">{artist.type}</dd>
            </div>
          ) : null}
          {artist.country ? (
            <div className="flex gap-2">
              <dt className="text-[var(--muted-dim)]">Country</dt>
              <dd className="text-[var(--foreground)]">{artist.country}</dd>
            </div>
          ) : null}
          {releaseCount > 0 ? (
            <div className="flex gap-2">
              <dt className="text-[var(--muted-dim)]">Release groups</dt>
              <dd className="text-[var(--foreground)]">
                {releaseCount.toLocaleString()}
                {releasesComplete ? null : (
                  <span className="ml-2 text-xs text-[var(--amber-soft)]">
                    partially retrieved
                  </span>
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {tags.length > 0 ? (
        <ul aria-label="MusicBrainz tags" className="mt-5 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-[var(--surface-subtle)] px-3 py-1 text-xs text-[var(--muted)]"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-[var(--muted-dim)]">
          MusicBrainz records no community tags for this artist. Absent tags are
          not evidence of absent influences.
        </p>
      )}

      <ProviderAttribution
        className="mt-6 text-xs leading-5 text-[var(--muted-dim)]"
        sources={[{ label: "MusicBrainz", url: artist.attribution.sourceUrl }]}
      />
    </header>
  );
}
