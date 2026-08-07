import { History } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HistoryList } from "@/features/history/components/history-list";
import { readHistoryPage } from "@/features/history/repository";
import {
  HISTORY_TRACKING_STARTED_AT,
  predatesHistoryTracking,
} from "@/lib/library/sessions";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "History" };

const TRACKING_STARTED_LABEL = new Date(
  HISTORY_TRACKING_STARTED_AT,
).toLocaleDateString("en-GB", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export default async function HistoryPage() {
  const { user } = await getAuthenticatedUser();
  const page = await readHistoryPage({ userId: user.id, cursor: null });

  // The distinction that matters. A brand-new account and one that predates
  // recording both show nothing, and "no history yet" is only true for the
  // first — for the second it implies nothing happened, when the truth is that
  // nothing was recorded.
  const predatesTracking = predatesHistoryTracking(user.created_at);

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Discovery history"
        title="Every trail, easy to retrace."
        description="Artist searches, mood briefs, and discography conversations, with what each one produced."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {page.entries.length > 0 ? (
          <HistoryList initialEntries={page.entries} total={page.total} />
        ) : predatesTracking ? (
          <EmptyState
            title={`History recording began on ${TRACKING_STARTED_LABEL}`}
            description="Your account is older than this feature, so anything you did before that date was never recorded and cannot be reconstructed. Discoveries, moods and discography questions from now on will appear here."
          />
        ) : (
          <EmptyState
            title="Nothing recorded yet"
            description="Search for an artist, describe a mood, or ask about a discography, and it will appear here."
          />
        )}
        <Card variant="quiet" className="h-fit">
          <History aria-hidden="true" className="size-5 text-[var(--muted)]" />
          <h2 className="mt-6 font-semibold">History controls</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Every entry is scoped to your account. Deleting one removes it and
            anything it recorded, permanently and without an undo.
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            A playlist created in Spotify belongs to your Spotify account.
            Deleting history here does not remove it from there.
          </p>
        </Card>
      </div>
    </div>
  );
}
