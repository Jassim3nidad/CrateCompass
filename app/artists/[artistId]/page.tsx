import { Compass, Disc3, GitBranch, Library, ListMusic } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { QuestionPanel } from "@/features/discography/components/question-panel";
import { ReleaseTimeline } from "@/features/discography/components/release-timeline";
import { readLatestConversation } from "@/features/discography/repository";
import { loadDiscography } from "@/features/discography/service";
import { ArtistHeader } from "@/features/discovery/components/artist-header";
import { SpotifyLink } from "@/features/discovery/components/spotify-link";
import { loadSeedArtist } from "@/features/discovery/service";
import { readRemainingDailyUsage } from "@/lib/ai/limits";
import { suggestedQuestions } from "@/lib/discography/suggestions";
import { getOptionalUser } from "@/lib/supabase/auth";

interface ArtistPageProps {
  readonly params: Promise<{ artistId: string }>;
}

const MBID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: ArtistPageProps): Promise<Metadata> {
  const { artistId } = await params;

  if (!MBID_PATTERN.test(artistId)) {
    return { title: "Unrecognised artist identifier" };
  }

  // The lookup cache shares this request with the page body, so the title
  // costs no additional MusicBrainz call.
  const seed = await loadSeedArtist(artistId);
  return { title: seed.ok ? seed.value.artist.name : "Artist" };
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { artistId } = await params;

  if (!MBID_PATTERN.test(artistId)) {
    return <ArtistShell artistId={artistId} />;
  }

  const seed = await loadSeedArtist(artistId);

  if (!seed.ok) {
    return (
      <div className="page-shell">
        <ErrorState
          title={
            seed.failure === "not-found"
              ? "That artist could not be found"
              : "MusicBrainz is unavailable"
          }
          description={seed.message}
        />
      </div>
    );
  }

  const { artist, releaseGroupTotal, releasesComplete } = seed.value;

  // The same six-hour cached lookup the seed load used, so this is a second
  // read of one retrieval rather than a second retrieval.
  const [discography, { user }] = await Promise.all([
    loadDiscography(artistId),
    getOptionalUser(),
  ]);

  const [conversation, remainingQuota] = await Promise.all([
    user
      ? readLatestConversation({ userId: user.id, canonicalArtistId: artistId })
      : Promise.resolve(null),
    user ? readRemainingDailyUsage(user.id) : Promise.resolve(null),
  ]);

  return (
    <div className="page-shell space-y-6">
      <ArtistHeader
        artist={artist}
        releaseCount={releaseGroupTotal}
        releasesComplete={releasesComplete}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="accent">
          <Link
            href={`/discover?q=${encodeURIComponent(artist.name)}&artist=${artist.mbid}`}
          >
            <Compass aria-hidden="true" className="size-4" />
            Find related artists
          </Link>
        </Button>
        <SpotifyLink mbid={artist.mbid} artistName={artist.name} />
      </div>

      {discography.ok ? (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Discography</CardTitle>
                  <CardDescription>
                    Every release group MusicBrainz records, oldest first.
                  </CardDescription>
                </div>
                <Disc3
                  aria-hidden="true"
                  className="size-6 text-[var(--electric-soft)]"
                />
              </div>
            </CardHeader>
            <ReleaseTimeline discography={discography.value} />
          </Card>

          <QuestionPanel
            artistMbid={artist.mbid}
            artistName={artist.name}
            signedIn={Boolean(user)}
            remainingQuota={remainingQuota}
            initialMessages={conversation?.messages ?? []}
            suggestions={suggestedQuestions(discography.value)}
          />
        </div>
      ) : (
        <ErrorState
          title="The discography could not be retrieved"
          description={discography.message}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Saved context</CardTitle>
                <CardDescription>
                  Favourites and notes stay application-owned and private to the
                  signed-in listener.
                </CardDescription>
              </div>
              <ListMusic
                aria-hidden="true"
                className="size-6 shrink-0 text-[var(--amber-soft)]"
              />
            </div>
          </CardHeader>
          {user ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="secondary">
                <Link
                  href={`/library?q=${encodeURIComponent(artist.name)}`}
                  prefetch={false}
                >
                  <Library aria-hidden="true" className="size-4" />
                  Find {artist.name} in your library
                </Link>
              </Button>
              <p className="text-sm leading-6 text-[var(--muted)]">
                Saving happens from a discovery result, where the reasoning that
                caused the save can be kept with it.
              </p>
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--muted)]">
              <Link
                href={`/auth/sign-in?returnTo=/artists/${artist.mbid}`}
                className="focus-ring rounded underline underline-offset-2 hover:text-[var(--foreground)]"
              >
                Sign in
              </Link>{" "}
              to keep favourites and notes. Browsing this discography needs no
              account.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * What `/artists/<something that is not an MBID>` renders.
 *
 * Not a 404, deliberately. The address is a real route with an unusable
 * parameter, and saying so — while naming what a usable one looks like — is
 * more actionable than "page not found". It fabricates no artist data, which is
 * the property that matters: an artist page with invented content would be the
 * exact failure this product exists to avoid.
 */
function ArtistShell({ artistId }: { readonly artistId: string }) {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Canonical artist"
        title="That is not an artist identifier."
        description="Artist pages are addressed by MusicBrainz ID, so this address cannot be resolved to anyone. Nothing has been fetched or guessed for it."
        action={
          <Button asChild variant="accent">
            <Link href="/discover">
              <Compass aria-hidden="true" className="size-4" />
              Search for an artist
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <Card variant="raised">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Relationship map</CardTitle>
                <CardDescription>
                  Similarity evidence is attributed and confidence-labelled.
                </CardDescription>
              </div>
              <GitBranch
                aria-hidden="true"
                className="size-6 shrink-0 text-[var(--muted-dim)]"
              />
            </div>
          </CardHeader>
          <EmptyState
            title="No artist to map"
            description={`"${artistId}" is not a MusicBrainz identifier. Start from discovery to pick a canonical artist, and the map fills in from there.`}
            action={
              <Button asChild variant="secondary">
                <Link href="/discover">Go to discovery</Link>
              </Button>
            }
          />
        </Card>

        <div className="space-y-6">
          <Card>
            <Disc3
              aria-hidden="true"
              className="size-5 text-[var(--electric-soft)]"
            />
            <h2 className="mt-8 text-xl font-semibold tracking-[-0.025em]">
              Discography
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Albums, EPs, singles, and date precision come from MusicBrainz.
            </p>
          </Card>
          <Card>
            <ListMusic
              aria-hidden="true"
              className="size-5 text-[var(--amber-soft)]"
            />
            <h2 className="mt-8 text-xl font-semibold tracking-[-0.025em]">
              Saved context
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Notes and favourites remain application-owned and private to the
              signed-in user.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
