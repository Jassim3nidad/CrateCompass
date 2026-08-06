import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MoodWorkflow } from "@/features/mood/components/mood-workflow";
import { getOptionalUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Mood" };

/**
 * The mood surface requires an account, unlike discovery.
 *
 * Two reasons, both real rather than administrative: interpretation spends
 * metered AI usage that has to be charged to someone, and the draft it produces
 * is a durable record the listener needs to be able to come back to.
 */
export default async function MoodPage() {
  const { user } = await getOptionalUser();

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Mood compass"
        title="Describe the room, not a dropdown."
        description="Write the atmosphere in your own words. Every step of the interpretation stays visible, and nothing reaches Spotify until you confirm it."
      />

      {user ? (
        <MoodWorkflow />
      ) : (
        <EmptyState
          title="Sign in to build a playlist"
          description="Mood interpretation is metered per account, and the draft it produces is saved so you can come back to it. Artist discovery works without an account."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild variant="accent">
                <Link href="/auth/sign-in?returnTo=/mood">Sign in</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/discover">Go to discovery</Link>
              </Button>
            </div>
          }
        />
      )}
    </div>
  );
}
