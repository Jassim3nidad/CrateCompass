"use client";

import { BookmarkCheck, BookmarkPlus, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  saveDiscoveryAction,
  unsaveDiscoveryAction,
} from "@/features/discovery/actions";
import { ExplanationPanel } from "@/features/discovery/components/explanation-panel";
import { SpotifyLink } from "@/features/discovery/components/spotify-link";
import { StrengthBadge } from "@/features/discovery/components/strength-badge";
import type { DiscoveryCandidate } from "@/lib/discovery/types";

/**
 * One discovered artist.
 *
 * The card shows what is known before any enrichment: who reported the
 * relationship, how strong it is within this set, and what MusicBrainz calls
 * the artist. Everything that costs another provider request — the evidence,
 * the written explanation, the Spotify link — is behind an explicit action.
 */
export function DiscoveryCard({
  seedMbid,
  seedName,
  candidate,
  onDismiss,
}: {
  readonly seedMbid: string;
  readonly seedName: string;
  readonly candidate: DiscoveryCandidate;
  readonly onDismiss: (candidate: DiscoveryCandidate) => void;
}) {
  const [saved, setSaved] = useState(candidate.saved);
  const [notice, setNotice] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleSave() {
    startTransition(async () => {
      const result = saved
        ? await unsaveDiscoveryAction({ mbid: candidate.mbid })
        : await saveDiscoveryAction({
            mbid: candidate.mbid,
            name: candidate.name,
            sourceUrl: candidate.sourceUrl,
          });

      setAuthRequired(result.status === "auth-required");
      setNotice(result.message);

      if (result.status === "saved" || result.status === "already-saved") {
        setSaved(true);
        // Confirmation is the button changing colour, icon and label; the pop
        // is only there to draw the eye to a change that happens well below
        // where the pointer usually is. It is one shot, and the state it
        // celebrates is already legible without it.
        setJustSaved(true);
      } else if (result.status === "removed") {
        setSaved(false);
        setJustSaved(false);
      }
    });
  }

  return (
    <Card
      variant="raised"
      className="transition-colors hover:border-[var(--muted-dim)] motion-reduce:transition-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-[var(--muted-dim)]">
            <span className="sr-only">Provider rank </span>#{candidate.rank}
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-[var(--foreground)]">
            <Link
              href={`/artists/${candidate.mbid}`}
              className="focus-ring rounded hover:underline"
            >
              {candidate.name}
            </Link>
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            {[candidate.disambiguation, candidate.type]
              .filter(Boolean)
              .join(" · ") || "No disambiguation recorded"}
          </p>
        </div>
        <StrengthBadge
          strength={candidate.strength}
          relativeScore={candidate.relativeScore}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={saved ? "accent" : "secondary"}
          size="sm"
          onClick={toggleSave}
          disabled={pending}
          aria-pressed={saved}
          // Fires once, then the class is dropped so a later re-render cannot
          // replay it. Under reduced motion the class resolves to nothing and
          // this event never arrives, which is harmless: the flag then only
          // gates a rule that does not exist.
          onAnimationEnd={() => setJustSaved(false)}
          className={justSaved ? "motion-confirm" : undefined}
        >
          {saved ? (
            <BookmarkCheck aria-hidden="true" className="size-4" />
          ) : (
            <BookmarkPlus aria-hidden="true" className="size-4" />
          )}
          {saved ? "Saved" : "Save"}
          <span className="sr-only"> {candidate.name}</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onDismiss(candidate)}
        >
          <X aria-hidden="true" className="size-4" />
          Dismiss
          <span className="sr-only"> {candidate.name}</span>
        </Button>

        <SpotifyLink mbid={candidate.mbid} artistName={candidate.name} />
      </div>

      {notice ? (
        <p
          className={`mt-3 text-sm leading-6 ${authRequired ? "text-[var(--amber-soft)]" : "text-[var(--muted)]"}`}
        >
          {notice}
          {authRequired ? (
            <>
              {" "}
              <Link
                href="/auth/sign-in?returnTo=/discover"
                className="focus-ring rounded underline underline-offset-2 hover:text-[var(--foreground)]"
              >
                Sign in
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <ExplanationPanel
        seedMbid={seedMbid}
        seedName={seedName}
        candidateMbid={candidate.mbid}
        candidateName={candidate.name}
      />
    </Card>
  );
}
