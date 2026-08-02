import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PhaseNotice } from "@/components/ui/phase-notice";
import { ArtistSearchForm } from "@/features/foundation/components/artist-search-form";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Artist discovery"
        title="Start with a record you already trust."
        description="Choose a canonical artist first. Similarity evidence and explanations will stay separate from Spotify resolution."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card variant="raised">
          <CardHeader>
            <CardTitle>Find the canonical artist</CardTitle>
            <CardDescription>
              Search will be resolved by MusicBrainz, with aliases and ambiguity
              shown before selection.
            </CardDescription>
          </CardHeader>
          <ArtistSearchForm />
          <div className="mt-6">
            <PhaseNotice>
              Search is intentionally local in Phase 1; no provider request is
              made.
            </PhaseNotice>
          </div>
        </Card>
        <EmptyState
          title="No discovery trail yet"
          description="Once MusicBrainz and the approved discovery provider are connected, canonical candidates and sourced relationships will appear here."
        />
      </div>
    </div>
  );
}
