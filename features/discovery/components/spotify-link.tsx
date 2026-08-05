"use client";

import { ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { resolveArtistOnSpotifyAction } from "@/features/spotify/actions";
import {
  initialSpotifyLinkState,
  type SpotifyLinkState,
} from "@/features/spotify/state";

/**
 * Opens a discovered artist in Spotify.
 *
 * Resolution happens when asked for, never as a side effect of rendering a
 * result: Spotify is a linking destination here, not a source of
 * recommendations, and a page of twelve results must not fire twelve searches
 * against a connected account nobody asked it to use.
 *
 * When the deterministic matcher cannot decide, the alternatives are listed for
 * the listener to choose. Nothing auto-navigates.
 */
export function SpotifyLink({
  mbid,
  artistName,
}: {
  readonly mbid: string;
  readonly artistName: string;
}) {
  const [state, setState] = useState<SpotifyLinkState>(initialSpotifyLinkState);
  const [pending, startTransition] = useTransition();

  function resolve() {
    startTransition(async () => {
      setState(await resolveArtistOnSpotifyAction({ mbid }));
    });
  }

  if (state.status === "resolved") {
    return (
      <a
        href={state.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--surface-raised)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] focus-visible:outline-none"
      >
        <ExternalLink aria-hidden="true" className="size-4" />
        Open {state.name} in Spotify
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={resolve}
        disabled={pending}
      >
        <ExternalLink aria-hidden="true" className="size-4" />
        {pending ? "Checking Spotify…" : "Find on Spotify"}
      </Button>

      {state.status === "ambiguous" ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--amber)_35%,var(--border))] bg-[color-mix(in_srgb,var(--amber)_8%,transparent)] p-3">
          <p className="text-sm leading-6 text-[var(--amber-soft)]">
            {state.reason}
          </p>
          <ul className="mt-2 space-y-1">
            {state.options.map((option) => (
              <li key={option.url}>
                <a
                  href={option.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded text-sm text-[var(--foreground)] underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
                >
                  {option.name}
                  <span className="sr-only">
                    {" "}
                    on Spotify (opens in a new tab)
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.status === "unresolved" ? (
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {state.reason} {artistName} stays discoverable through the sources
          above.
        </p>
      ) : null}

      {state.status === "not-connected" ||
      state.status === "reconnect-required" ||
      state.status === "unavailable" ? (
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {state.message}{" "}
          <a
            href="/settings/connections"
            className="rounded underline underline-offset-2 hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          >
            Manage connections
          </a>
        </p>
      ) : null}
    </div>
  );
}
