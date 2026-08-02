import { History } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Discovery history"
        title="Every trail, easy to retrace."
        description="Revisit artist searches, mood briefs, partial provider results, and playlists you explicitly approved."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <EmptyState
          title="No sessions recorded"
          description="History begins only after authenticated, RLS-protected persistence is approved and implemented."
        />
        <Card variant="quiet" className="h-fit">
          <History aria-hidden="true" className="size-5 text-[var(--muted)]" />
          <h2 className="mt-6 font-semibold">History controls</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Filters, individual deletion, and clear-history controls arrive with
            the protected data model.
          </p>
        </Card>
      </div>
    </div>
  );
}
