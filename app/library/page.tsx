import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const { supabase } = await getAuthenticatedUser();
  const { data: favorites } = await supabase
    .from("favorite_discoveries")
    .select("id, artist_name, recording_name, note, source_type, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Personal library"
        title="The finds you chose to keep."
        description="Favorites, explanations, notes, albums, and generated playlist records will live here—not a mirrored streaming catalog."
      />
      {favorites?.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {favorites.map((favorite) => (
            <li key={favorite.id}>
              <Card className="h-full">
                <p className="text-xs font-semibold tracking-[0.15em] text-[var(--muted-dim)] uppercase">
                  {favorite.source_type}
                </p>
                <h2 className="mt-3 text-lg font-semibold">
                  {favorite.artist_name}
                </h2>
                {favorite.recording_name ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {favorite.recording_name}
                  </p>
                ) : null}
                {favorite.note ? (
                  <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                    {favorite.note}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Your library is quiet"
          description="Save a discovery and it will appear here in your private library."
          action={
            <Button asChild variant="secondary">
              <Link href="/discover">
                <Compass aria-hidden="true" className="size-4" />
                Explore discovery
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
