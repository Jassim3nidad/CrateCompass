import { Compass } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ArtistHeader } from "@/features/discovery/components/artist-header";
import { ArtistSearchForm } from "@/features/discovery/components/artist-search-form";
import { CandidateSelection } from "@/features/discovery/components/candidate-selection";
import { DiscoveryResults } from "@/features/discovery/components/discovery-results";
import {
  loadDiscoveryPage,
  loadSeedArtist,
  searchCanonicalArtists,
} from "@/features/discovery/service";
import { getOptionalUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Discover" };

interface DiscoverPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
    readonly artist?: string;
  }>;
}

/**
 * The discovery surface.
 *
 * State lives in the URL — the query and the selected artist — so a trail is
 * shareable and the back button works the way a listener expects while moving
 * between candidates. The two provider-backed regions stream independently, so
 * a slow similarity call never delays the search results next to it.
 */
export default async function DiscoverPage({
  searchParams,
}: DiscoverPageProps) {
  const { q = "", artist = "" } = await searchParams;
  const query = q.trim().slice(0, 200);

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Artist discovery"
        title="Start with a record you already trust."
        description="Choose a canonical artist first. Similarity evidence comes from ListenBrainz, facts from MusicBrainz, and Spotify is used only to open what you find."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
        <div className="space-y-6 lg:sticky lg:top-6">
          <Card variant="raised">
            <CardHeader>
              <CardTitle>Find the canonical artist</CardTitle>
              <CardDescription>
                Search resolves through MusicBrainz, with aliases and ambiguity
                shown before selection.
              </CardDescription>
            </CardHeader>
            <ArtistSearchForm defaultQuery={query} />
          </Card>

          {query.length > 0 ? (
            <Suspense key={`search-${query}`} fallback={<CandidateSkeleton />}>
              <SearchResults query={query} selectedMbid={artist || null} />
            </Suspense>
          ) : null}
        </div>

        {artist.length > 0 ? (
          <Suspense key={`discovery-${artist}`} fallback={<ResultsSkeleton />}>
            <DiscoveryPanel mbid={artist} />
          </Suspense>
        ) : (
          <EmptyState
            title="No discovery trail yet"
            description="Search for an artist and choose the exact one you mean. Related artists, the evidence behind each relationship, and an explanation you can trace will appear here."
          />
        )}
      </div>
    </div>
  );
}

async function SearchResults({
  query,
  selectedMbid,
}: {
  readonly query: string;
  readonly selectedMbid: string | null;
}) {
  const result = await searchCanonicalArtists(query);

  if (!result.ok) {
    return (
      <ErrorState
        title="MusicBrainz search is unavailable"
        description={result.message}
      />
    );
  }

  if (result.value.length === 0) {
    return (
      <EmptyState
        title="No canonical artist matched"
        description={`MusicBrainz has no artist matching “${query}”. Try an alternative spelling, or the name as it appears on a release.`}
      />
    );
  }

  return (
    <CandidateSelection
      query={query}
      candidates={result.value}
      selectedMbid={selectedMbid}
    />
  );
}

async function DiscoveryPanel({ mbid }: { readonly mbid: string }) {
  const seed = await loadSeedArtist(mbid);

  if (!seed.ok) {
    return (
      <ErrorState
        title={
          seed.failure === "not-found"
            ? "That artist could not be found"
            : "MusicBrainz is unavailable"
        }
        description={seed.message}
      />
    );
  }

  const { user } = await getOptionalUser();
  const page = await loadDiscoveryPage({
    seed: seed.value.artist,
    offset: 0,
    userId: user?.id ?? null,
  });

  return (
    <div className="space-y-6">
      <ArtistHeader
        artist={seed.value.artist}
        releaseCount={seed.value.releaseGroupTotal}
        releasesComplete={seed.value.releasesComplete}
      />

      {/* A discovery-provider failure must not take the artist page with it:
          the canonical record above is still accurate and still useful. */}
      {!page.ok ? (
        <ErrorState
          title={
            page.failure === "rate-limited"
              ? "The discovery provider is rate limiting requests"
              : "Related artists are unavailable"
          }
          description={page.message}
        />
      ) : page.value.candidates.length === 0 ? (
        <EmptyState
          title={
            page.value.dismissedCount > 0
              ? "Every suggestion here has been dismissed"
              : "No related artists reported"
          }
          description={
            page.value.dismissedCount > 0
              ? `You dismissed all ${page.value.dismissedCount} artists the provider reported for ${seed.value.artist.name}.`
              : `ListenBrainz reports no similar artists for ${seed.value.artist.name}. That is a gap in the data, not proof that none exist.`
          }
        />
      ) : (
        <section aria-labelledby="results-heading">
          <div className="mb-4 flex items-center gap-3">
            <Compass
              aria-hidden="true"
              className="size-5 text-[var(--accent-foreground)]"
            />
            <h2
              id="results-heading"
              className="text-lg font-semibold tracking-[-0.02em] text-[var(--text-primary)]"
            >
              Related to {seed.value.artist.name}
            </h2>
          </div>
          <DiscoveryResults
            seedMbid={seed.value.artist.mbid}
            seedName={seed.value.artist.name}
            initialCandidates={page.value.candidates}
            initialHasMore={page.value.hasMore}
            initialNextOffset={page.value.nextOffset}
            attributionUrl={page.value.attribution.sourceUrl}
          />
        </section>
      )}
    </div>
  );
}

function CandidateSkeleton() {
  return (
    <div aria-busy="true" className="space-y-2">
      <span className="sr-only">Searching MusicBrainz…</span>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-20 w-full" />
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span className="sr-only">Loading related artists…</span>
      <Skeleton className="h-56 w-full" />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-40 w-full" />
      ))}
    </div>
  );
}
