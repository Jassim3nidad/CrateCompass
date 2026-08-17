"use client";

import { ChevronDown, Sparkles, TriangleAlert } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldDescription, Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { explainDiscoveryAction } from "@/features/discovery/actions";
import { ProviderAttribution } from "@/features/discovery/components/provider-attribution";
import {
  EXPLANATION_SOURCE_NOTES,
  type ExplanationResult,
} from "@/features/discovery/state";

/**
 * Why this match, on demand.
 *
 * Evidence is rendered above the prose, in that order, deliberately. The facts
 * are what the providers actually reported; the summary is interpretation of
 * those facts. Putting interpretation first would invite it to be read as the
 * source rather than the reading.
 *
 * The panel loads only when opened. A candidate's MusicBrainz record costs a
 * paced request, so fetching twelve of them for a page nobody expanded would
 * spend a listener's patience on evidence they did not ask for.
 */
export function ExplanationPanel({
  seedMbid,
  seedName,
  candidateMbid,
  candidateName,
}: {
  readonly seedMbid: string;
  readonly seedName: string;
  readonly candidateMbid: string;
  readonly candidateName: string;
}) {
  const panelId = useId();
  const buttonId = useId();
  const preferenceId = useId();
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [pending, startTransition] = useTransition();
  const preferenceRef = useRef<HTMLInputElement>(null);

  function request() {
    const listenerPreference = preferenceRef.current?.value.trim() ?? "";

    startTransition(async () => {
      setResult(
        await explainDiscoveryAction({
          seedMbid,
          candidateMbid,
          listenerPreference:
            listenerPreference.length > 0 ? listenerPreference : null,
        }),
      );
    });
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);

    if (next && result === null && !pending) {
      request();
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        id={buttonId}
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        // Nested inside DiscoveryCard (raised) — sunken, not a second raised
        // surface.
        className="focus-ring surface-sunken elev-inset hover:surface-raised inline-flex min-h-11 items-center gap-2 rounded-[var(--r-pill)] px-4 text-sm font-semibold text-[var(--foreground)] transition-[background-color] duration-[var(--duration-fast)] motion-reduce:transition-none"
      >
        <Sparkles
          aria-hidden="true"
          className="size-4 text-[var(--violet-soft)]"
        />
        Why this match?
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!expanded}
        aria-busy={pending}
        // `hidden` is `display: none`, which takes the element out of the box
        // tree entirely — so the entrance restarts every time it is reopened
        // rather than playing once and never again.
        className="motion-expand surface-sunken elev-inset mt-4 rounded-[var(--r-md)] p-4"
      >
        {pending ? (
          <div>
            <span className="sr-only">Gathering evidence…</span>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-3 h-4 w-5/6" />
          </div>
        ) : null}

        {!pending && result?.status === "failed" ? (
          <div role="alert">
            <p className="text-sm leading-6 text-[var(--danger-soft)]">
              {result.message}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={request}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {!pending && result?.status === "ready" ? (
          <div className="space-y-5">
            <section aria-labelledby={`${panelId}-evidence`}>
              <h4
                id={`${panelId}-evidence`}
                className="text-xs font-bold tracking-[0.16em] text-[var(--amber-soft)] uppercase"
              >
                Evidence
              </h4>
              <ul className="mt-3 space-y-2">
                {result.evidence.facts.map((fact, index) => (
                  <li
                    key={index}
                    className="flex gap-3 text-sm leading-6 text-[var(--muted)]"
                  >
                    <span className="mt-0.5 h-fit shrink-0 rounded-full bg-[var(--surface)] px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide text-[var(--muted-dim)] uppercase">
                      {fact.source}
                    </span>
                    <span>{fact.statement}</span>
                  </li>
                ))}
              </ul>
              {result.evidence.depth === "similarity-only" ? (
                <p className="mt-3 text-sm leading-6 text-[var(--amber-soft)]">
                  MusicBrainz details for {candidateName} could not be
                  retrieved, so this rests on similarity data alone.
                </p>
              ) : null}
            </section>

            <section aria-labelledby={`${panelId}-reading`}>
              <h4
                id={`${panelId}-reading`}
                className="text-xs font-bold tracking-[0.16em] text-[var(--amber-soft)] uppercase"
              >
                Reading of the evidence
              </h4>
              <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">
                {result.explanation.summary}
              </p>

              {result.explanation.sharedCharacteristics.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {result.explanation.sharedCharacteristics.map(
                    (characteristic) => (
                      <li
                        key={characteristic}
                        className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)]"
                      >
                        {characteristic}
                      </li>
                    ),
                  )}
                </ul>
              ) : null}

              {result.explanation.contrast ? (
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  <span className="font-semibold text-[var(--foreground)]">
                    What differs:{" "}
                  </span>
                  {result.explanation.contrast}
                </p>
              ) : null}

              {result.explanation.startingPoint ? (
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  <span className="font-semibold text-[var(--foreground)]">
                    Start with:{" "}
                  </span>
                  {result.explanation.startingPoint.title}
                  {result.explanation.startingPoint.year
                    ? ` (${result.explanation.startingPoint.year})`
                    : ""}
                  {result.explanation.startingPoint.sourceUrl ? (
                    <>
                      {" — "}
                      <a
                        href={result.explanation.startingPoint.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="focus-ring rounded underline underline-offset-2 hover:text-[var(--foreground)]"
                      >
                        MusicBrainz record
                      </a>
                    </>
                  ) : null}
                </p>
              ) : null}

              <p className="mt-4 text-xs leading-5 text-[var(--muted-dim)]">
                {EXPLANATION_SOURCE_NOTES[result.source]}
                {result.explanation.model
                  ? ` Model: ${result.explanation.model}.`
                  : ""}
              </p>
            </section>

            <div className="pt-4">
              <Label htmlFor={preferenceId}>
                What do you like about {seedName}?
              </Label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input
                  id={preferenceId}
                  ref={preferenceRef}
                  type="text"
                  maxLength={2000}
                  placeholder="Optional — in your own words"
                  aria-describedby={`${preferenceId}-description`}
                  className="flex-1"
                />
                <Button type="button" variant="secondary" onClick={request}>
                  Rewrite with this
                </Button>
              </div>
              <FieldDescription id={`${preferenceId}-description`}>
                Only your own words are sent. Nothing from Spotify is ever
                included.
              </FieldDescription>

              {/* Shown next to the field it describes, not buried in a policy
                  page: the listener needs it at the moment they type. */}
              {result.inputDisclosure ? (
                <p className="mt-2 flex gap-2 text-xs leading-5 text-[var(--amber-soft)]">
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0"
                  />
                  <span>{result.inputDisclosure}</span>
                </p>
              ) : null}
            </div>

            <ProviderAttribution
              sources={[
                { label: "ListenBrainz", url: "https://listenbrainz.org" },
                { label: "MusicBrainz", url: "https://musicbrainz.org" },
              ]}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
