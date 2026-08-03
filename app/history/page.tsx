import { History } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage() {
  const { supabase } = await getAuthenticatedUser();
  const { data: sessions } = await supabase
    .from("discovery_sessions")
    .select("id, input_kind, input_value, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Discovery history"
        title="Every trail, easy to retrace."
        description="Revisit artist searches, mood briefs, partial provider results, and playlists you explicitly approved."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {sessions?.length ? (
          <ul className="space-y-3">
            {sessions.map((session) => (
              <li key={session.id}>
                <Card>
                  <p className="text-xs font-semibold tracking-[0.15em] text-[var(--muted-dim)] uppercase">
                    {session.input_kind} · {session.status}
                  </p>
                  <h2 className="mt-3 text-lg font-semibold">
                    {session.input_value}
                  </h2>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No sessions recorded"
            description="Your RLS-protected discovery history will appear here."
          />
        )}
        <Card variant="quiet" className="h-fit">
          <History aria-hidden="true" className="size-5 text-[var(--muted)]" />
          <h2 className="mt-6 font-semibold">History controls</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Every query is scoped to your authenticated user ID. Filters and
            clear-history controls arrive with live discovery providers.
          </p>
        </Card>
      </div>
    </div>
  );
}
