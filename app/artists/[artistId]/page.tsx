import { Disc3, ExternalLink, GitBranch, ListMusic } from "lucide-react";
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
import { PhaseNotice } from "@/components/ui/phase-notice";

interface ArtistPageProps {
  readonly params: Promise<{ artistId: string }>;
}

export async function generateMetadata({
  params,
}: ArtistPageProps): Promise<Metadata> {
  const { artistId } = await params;
  return {
    title:
      artistId === "foundation-preview" ? "Artist view" : "Artist workspace",
  };
}

export default async function ArtistPage({ params }: ArtistPageProps) {
  const { artistId } = await params;
  const isPreview = artistId === "foundation-preview";

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Canonical artist"
        title={isPreview ? "Artist workspace" : "Artist identity pending"}
        description="A future canonical artist page will separate discography facts, relationship evidence, personal notes, and Spotify links by source."
        action={
          <Button variant="secondary" disabled>
            <ExternalLink aria-hidden="true" className="size-4" />
            Open in Spotify
          </Button>
        }
      />

      <PhaseNotice>
        Route parameter:{" "}
        <code className="font-mono text-xs text-[var(--foreground)]">
          {artistId}
        </code>
        . No artist metadata has been fabricated for this shell.
      </PhaseNotice>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <Card variant="raised" className="min-h-96">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Relationship map</CardTitle>
                <CardDescription>
                  Similarity evidence will be attributed and confidence-labeled.
                </CardDescription>
              </div>
              <GitBranch
                aria-hidden="true"
                className="size-6 text-[var(--muted-dim)]"
              />
            </div>
          </CardHeader>
          <EmptyState
            title="No sourced relationships"
            description="Select a canonical MusicBrainz artist in the discovery flow before loading provider evidence."
          />
        </Card>

        <div className="space-y-6">
          <Card>
            <Disc3
              aria-hidden="true"
              className="size-5 text-[var(--electric)]"
            />
            <h2 className="mt-8 text-xl font-semibold tracking-[-0.025em]">
              Discography
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Albums, EPs, singles, and date precision will come from
              MusicBrainz.
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
              Notes and favorites will remain application-owned and private to
              the signed-in user.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
