import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Personal library"
        title="The finds you chose to keep."
        description="Favorites, explanations, notes, albums, and generated playlist records will live here—not a mirrored streaming catalog."
      />
      <EmptyState
        title="Your library is quiet"
        description="Saved discoveries will appear after authentication and persistence are implemented in Phase 2."
        action={
          <Button asChild variant="secondary">
            <Link href="/discover">
              <Compass aria-hidden="true" className="size-4" />
              Explore the discovery shell
            </Link>
          </Button>
        }
      />
    </div>
  );
}
