import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MoodWorkflow } from "@/features/mood/components/mood-workflow";
import {
  resumeParamsSchema,
  resumedControls,
  toResumableDraft,
  type ResumedDraft,
} from "@/features/mood/resume";
import { readDraft } from "@/features/playlists/repository";
import { callbackPresentation } from "@/features/spotify/connection-presentation";
import type { SpotifyCallbackStatus } from "@/features/spotify/state";
import { getOptionalUser } from "@/lib/supabase/auth";

export const metadata: Metadata = { title: "Mood" };

interface MoodPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The mood surface requires an account, unlike discovery.
 *
 * Two reasons, both real rather than administrative: interpretation spends
 * metered AI usage that has to be charged to someone, and the draft it produces
 * is a durable record the listener is returned to after a reconnect.
 */
export default async function MoodPage({ searchParams }: MoodPageProps) {
  const { user } = await getOptionalUser();
  const params = await searchParams;

  const resumed = user ? await loadResumedDraft(user.id, params) : null;
  const callback = readCallbackStatus(params);

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Mood compass"
        title="Describe the room, not a dropdown."
        description="Write the atmosphere in your own words. Every step of the interpretation stays visible, and nothing reaches Spotify until you confirm it."
      />

      {callback ? (
        <p
          role={callback.tone === "success" ? "status" : "alert"}
          className={`mb-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 ${
            callback.tone === "success"
              ? "text-[var(--foreground)]"
              : "text-[var(--danger-soft)]"
          }`}
        >
          {callback.message}
        </p>
      ) : null}

      {user ? (
        <MoodWorkflow resumed={resumed} />
      ) : (
        <EmptyState
          title="Sign in to build a playlist"
          description="Mood interpretation is metered per account, and the draft it produces is saved to your account — if creating the playlist needs a Spotify reconnect, you are brought straight back to it. Artist discovery works without an account."
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

/**
 * Loads the draft named in the return path, if it is still resumable.
 *
 * Every failure here is silent and yields a fresh workflow: a draft belonging
 * to someone else, one already created, and a hand-edited identifier are all
 * indistinguishable from "nothing to resume", and none of them is worth an
 * error message. Ownership is enforced by the query, not by the caller.
 */
async function loadResumedDraft(
  userId: string,
  params: Record<string, string | string[] | undefined>,
): Promise<ResumedDraft | null> {
  const parsed = resumeParamsSchema.safeParse(params);

  if (!parsed.success) {
    return null;
  }

  const stored = await readDraft({ userId, playlistId: parsed.data.draft });

  if (!stored) {
    return null;
  }

  return toResumableDraft({
    stored,
    controls: resumedControls({
      params: parsed.data,
      isPublic: stored.isPublic,
    }),
  });
}

function readCallbackStatus(
  params: Record<string, string | string[] | undefined>,
): { readonly tone: "success" | "error"; readonly message: string } | null {
  const value = params.spotify;

  if (typeof value !== "string" || !(value in callbackPresentation)) {
    return null;
  }

  return callbackPresentation[value as SpotifyCallbackStatus];
}
