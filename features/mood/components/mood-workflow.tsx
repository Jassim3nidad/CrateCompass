"use client";

import { ExternalLink, Sparkles, TriangleAlert, X } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FieldDescription, Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildDraftAction,
  parseMoodAction,
  removeDraftTrackAction,
} from "@/features/mood/actions";
import type {
  DraftResult,
  MoodParseResult,
  SeedOption,
} from "@/features/mood/state";
import {
  WorkflowProgress,
  type WorkflowStage,
} from "@/features/mood/components/workflow-progress";
import { buildResumePath, type ResumedDraft } from "@/features/mood/resume";
import { createPlaylistAction } from "@/features/playlists/actions";
import { reconnectSpotify } from "@/features/spotify/actions";
import type { CreationResult } from "@/features/mood/state";
import { PLAYLIST_LENGTH } from "@/lib/mood/controls";

/**
 * The mood workflow, as four visible steps.
 *
 * The seed-confirmation step is the one that looks like friction and is not:
 * MusicBrainz tag search ranks by text relevance, so an unconfirmed seed
 * produces a playlist built on whatever Lucene happened to rank first. Asking a
 * person to recognise the right artist is what converts a poor list into a good
 * one, and the interface says so rather than apologising for it.
 *
 * Nothing reaches Spotify until the final confirmation, and the idempotency key
 * is minted once per draft so a double-click or a refresh cannot produce two
 * playlists.
 *
 * `resumed` is present when the listener has come back from a Spotify
 * reconnect. Connecting is a navigation to another origin, so none of this
 * state survives it; the server reloads the draft from its row and hands it
 * back here, which is what makes the reconnect prompt's promise true.
 */
export function MoodWorkflow({
  resumed = null,
}: {
  readonly resumed?: ResumedDraft | null;
}) {
  const moodId = useId();
  const lengthId = useId();
  const [moodText, setMoodText] = useState(resumed?.moodText ?? "");
  const [length, setLength] = useState<number>(
    resumed?.draft.status === "ready"
      ? resumed.draft.controls.length
      : PLAYLIST_LENGTH.default,
  );
  const [isPublic, setIsPublic] = useState(
    resumed?.draft.status === "ready" ? resumed.draft.controls.isPublic : false,
  );
  const [avoidExplicit, setAvoidExplicit] = useState(
    resumed?.draft.status === "ready"
      ? resumed.draft.controls.explicitContent === "avoid"
      : false,
  );
  const [parsed, setParsed] = useState<MoodParseResult | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(
    resumed?.draft ?? null,
  );
  const [creation, setCreation] = useState<CreationResult | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Set from whichever action is actually in flight, so the indicator states a
  // fact rather than animating a guess.
  const [stage, setStage] = useState<WorkflowStage>(
    resumed?.draft.status === "ready" ? "draft-ready" : "idle",
  );
  const [pending, startTransition] = useTransition();
  const idempotencyKey = useRef<string | null>(null);

  const controls = {
    length,
    isPublic,
    explicitContent: avoidExplicit ? ("avoid" as const) : ("allow" as const),
  };

  function parseMood() {
    setDraft(null);
    setCreation(null);
    idempotencyKey.current = null;
    setStage("interpreting");

    startTransition(async () => {
      const result = await parseMoodAction({ moodText, controls });
      setParsed(result);
      setStage(result.status === "ready" ? "seeds-ready" : "idle");
      setAnnouncement(
        result.status === "ready"
          ? `${result.seeds.length} seed artists found.`
          : result.status === "clarify"
            ? "A clarification is needed."
            : result.message,
      );
    });
  }

  function chooseSeed(seed: SeedOption) {
    setCreation(null);
    idempotencyKey.current = null;
    setStage("building");

    startTransition(async () => {
      const result = await buildDraftAction({
        moodText,
        seedMbid: seed.mbid,
        controls,
      });
      setDraft(result);
      setStage(result.status === "ready" ? "draft-ready" : "seeds-ready");
      setAnnouncement(
        result.status === "ready"
          ? `${result.tracks.length} tracks ready to review.`
          : result.message,
      );
    });
  }

  function removeTrack(trackId: string) {
    if (draft?.status !== "ready") return;
    const playlistId = draft.playlistId;

    startTransition(async () => {
      const result = await removeDraftTrackAction({ playlistId, trackId });

      if (!result.ok) {
        setAnnouncement(result.message);
        return;
      }

      setDraft((current) =>
        current?.status === "ready"
          ? {
              ...current,
              tracks: current.tracks.filter((track) => track.id !== trackId),
            }
          : current,
      );
      setAnnouncement(result.message);
    });
  }

  function confirmCreate() {
    if (draft?.status !== "ready") return;

    // Minted once and reused for every retry of this draft: a fresh key per
    // attempt would defeat the duplicate protection it exists for.
    idempotencyKey.current ??= `${draft.playlistId}-${crypto.randomUUID()}`;
    const key = idempotencyKey.current;
    const playlistId = draft.playlistId;
    setStage("creating");

    startTransition(async () => {
      const result = await createPlaylistAction({
        playlistId,
        idempotencyKey: key,
        avoidExplicit,
      });
      setCreation(result);
      setStage(
        result.status === "created" ||
          result.status === "partial" ||
          result.status === "already-created"
          ? "done"
          : "draft-ready",
      );
      setAnnouncement(
        result.status === "created"
          ? "Playlist created in Spotify."
          : result.status === "partial"
            ? result.message
            : result.status === "already-created"
              ? "That playlist was already created."
              : result.message,
      );
    });
  }

  /**
   * Leaves for Spotify carrying the draft in the return path.
   *
   * The draft row is already written, so nothing here needs saving first; what
   * the path carries is the identity to come back to, plus the two settings
   * that belong to this attempt rather than to the stored draft.
   */
  function reconnect() {
    if (draft?.status !== "ready") return;

    const returnTo = buildResumePath({
      playlistId: draft.playlistId,
      controls,
    });

    startTransition(async () => {
      // A successful start redirects to Spotify and never returns here. Only a
      // refusal to begin comes back with a message.
      const result = await reconnectSpotify(returnTo);

      if (result.status === "error" && result.message) {
        setAnnouncement(result.message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <Card variant="raised">
        <CardHeader>
          <CardTitle>Describe the moment</CardTitle>
          <CardDescription>
            Your own words only. Nothing from Spotify is sent for
            interpretation.
          </CardDescription>
        </CardHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor={moodId}>What are you listening for?</Label>
            <Textarea
              id={moodId}
              value={moodText}
              onChange={(event) => setMoodText(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Rainy commute but I need something hopeful"
              aria-describedby={`${moodId}-description`}
              className="mt-2"
            />
            <FieldDescription id={`${moodId}-description`}>
              Genres are matched against MusicBrainz tags. Energy and mood are
              recorded but cannot be filtered on — there is no source for them
              outside Spotify audio features, which may not inform discovery.
            </FieldDescription>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor={lengthId}>Tracks</Label>
              <Input
                id={lengthId}
                type="number"
                min={PLAYLIST_LENGTH.min}
                max={PLAYLIST_LENGTH.max}
                value={length}
                onChange={(event) =>
                  setLength(
                    Number.parseInt(event.target.value, 10) ||
                      PLAYLIST_LENGTH.default,
                  )
                }
                className="mt-2"
              />
            </div>

            <label className="flex items-end gap-2 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
                className="size-4 accent-[var(--violet)]"
              />
              Make the playlist public
            </label>

            <label className="flex items-end gap-2 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                checked={avoidExplicit}
                onChange={(event) => setAvoidExplicit(event.target.checked)}
                className="size-4 accent-[var(--violet)]"
              />
              Exclude explicit tracks
            </label>
          </div>

          <Button
            type="button"
            variant="accent"
            onClick={parseMood}
            disabled={pending || moodText.trim().length === 0}
          >
            <Sparkles aria-hidden="true" className="size-4" />
            {pending ? "Working…" : "Interpret this mood"}
          </Button>
        </div>
      </Card>

      {stage !== "idle" &&
      stage !== "seeds-ready" &&
      stage !== "draft-ready" ? (
        <WorkflowProgress stage={stage} />
      ) : null}

      {parsed?.status === "failed" ? (
        <p role="alert" className="text-sm text-[var(--danger-soft)]">
          {parsed.message}
        </p>
      ) : null}

      {parsed?.status === "clarify" ? (
        <Card>
          <CardHeader>
            <CardTitle>One question first</CardTitle>
          </CardHeader>
          <p className="text-sm leading-6 text-[var(--foreground)]">
            {parsed.question}
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Add that to your description above and interpret again. Nothing has
            been guessed in the meantime.
          </p>
        </Card>
      ) : null}

      {parsed?.status === "ready" ? (
        <Card>
          <CardHeader>
            <CardTitle>How this was understood</CardTitle>
            <CardDescription>
              Settings you chose are enforced. Items marked as a hint are
              recorded but cannot be filtered on.
            </CardDescription>
          </CardHeader>

          <dl className="grid gap-3 sm:grid-cols-2">
            {parsed.summary.map((entry) => (
              <div key={entry.label} className="flex gap-2 text-sm">
                <dt className="text-[var(--muted-dim)]">{entry.label}</dt>
                <dd className="text-[var(--foreground)]">
                  {entry.value}
                  {entry.isHintOnly ? (
                    <span className="ml-2 rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-xs text-[var(--muted)]">
                      hint only
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>

          {parsed.inputDisclosure ? (
            <p className="mt-4 flex gap-2 text-xs leading-5 text-[var(--amber-soft)]">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span>{parsed.inputDisclosure}</span>
            </p>
          ) : null}

          <div className="mt-6 pt-6">
            <h3 className="text-base font-semibold text-[var(--foreground)]">
              Choose the artist this should build from
            </h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
              MusicBrainz tag search orders by text relevance, not by how well
              an artist fits. Picking the one you mean is what makes the rest of
              the playlist good.
            </p>

            {parsed.emptyReason ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                {parsed.emptyReason}
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {parsed.seeds.map((seed) => (
                  <li key={seed.mbid}>
                    <button
                      type="button"
                      onClick={() => chooseSeed(seed)}
                      disabled={pending}
                      // Nested inside a raised Card — sunken, not a second
                      // raised surface. Hover only brightens the fill.
                      className="focus-ring surface-sunken elev-inset hover:surface-raised flex w-full items-center justify-between gap-4 rounded-[var(--r-md)] p-4 text-left transition-[background-color] disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-[var(--foreground)]">
                          {seed.name}
                        </span>
                        <span className="mt-1 block text-sm text-[var(--muted)]">
                          {[seed.disambiguation, seed.type, seed.country]
                            .filter(Boolean)
                            .join(" · ") || "No disambiguation recorded"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted-dim)]">
                        {seed.rankedByRelevanceOnly
                          ? "no tag votes"
                          : `${seed.tagVotes} tag votes`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}

      {draft?.status === "failed" ? (
        <p role="alert" className="text-sm text-[var(--danger-soft)]">
          {draft.message}
        </p>
      ) : null}

      {draft?.status === "ready" ? (
        <Card variant="raised">
          <CardHeader>
            <CardTitle>{draft.title}</CardTitle>
            <CardDescription>{draft.description}</CardDescription>
          </CardHeader>

          {draft.isShort ? (
            <p className="mb-4 text-sm leading-6 text-[var(--amber-soft)]">
              Only {draft.tracks.length} tracks matched the criteria, fewer than
              the {draft.controls.length} requested. Nothing has been padded out
              to reach the number.
            </p>
          ) : null}

          {draft.artistsWithoutTracks.length > 0 ? (
            <p className="mb-4 text-sm leading-6 text-[var(--muted)]">
              No studio recordings were available for{" "}
              {draft.artistsWithoutTracks.join(", ")}.
            </p>
          ) : null}

          <ol className="space-y-2">
            {draft.tracks.map((track) => (
              <li
                key={track.id}
                className="surface-sunken elev-inset flex items-center justify-between gap-4 rounded-[var(--r-md)] p-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--foreground)]">
                    {track.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">
                    {track.artistName}
                    {track.releaseTitle ? ` · ${track.releaseTitle}` : ""}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTrack(track.id)}
                  disabled={pending}
                >
                  <X aria-hidden="true" className="size-4" />
                  Remove
                  <span className="sr-only"> {track.title}</span>
                </Button>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-3 pt-6">
            <Button
              type="button"
              variant="accent"
              onClick={confirmCreate}
              disabled={pending || draft.tracks.length === 0}
            >
              {pending
                ? "Creating…"
                : `Create ${draft.controls.isPublic ? "public" : "private"} playlist in Spotify`}
            </Button>
            <p className="text-xs text-[var(--muted-dim)]">
              Tracks are matched to Spotify at this point. Nothing has been sent
              to Spotify yet.
            </p>
          </div>
        </Card>
      ) : null}

      {creation ? (
        <CreationOutcome
          result={creation}
          pending={pending}
          onReconnect={reconnect}
          onKeepEditing={() => setCreation(null)}
        />
      ) : null}
    </div>
  );
}

function CreationOutcome({
  result,
  pending,
  onReconnect,
  onKeepEditing,
}: {
  readonly result: CreationResult;
  readonly pending: boolean;
  readonly onReconnect: () => void;
  readonly onKeepEditing: () => void;
}) {
  if (result.status === "created" || result.status === "already-created") {
    return (
      <Card role="status">
        <CardHeader>
          <CardTitle>
            {result.status === "created"
              ? "Playlist created"
              : "Already created"}
          </CardTitle>
          <CardDescription>
            {result.tracksAdded} of {result.trackTotal} tracks are in Spotify.
          </CardDescription>
        </CardHeader>
        <a
          href={result.playlistUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="focus-ring surface-sunken elev-inset hover:surface-raised inline-flex min-h-11 items-center gap-2 rounded-[var(--r-pill)] px-4 text-sm font-semibold text-[var(--foreground)]"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          Open in Spotify
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </Card>
    );
  }

  if (result.status === "partial") {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>Created, but incomplete</CardTitle>
          <CardDescription>{result.message}</CardDescription>
        </CardHeader>
        {result.unresolved.length > 0 ? (
          <>
            <p className="text-sm text-[var(--muted)]">
              Not matched on Spotify:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
              {result.unresolved.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          </>
        ) : null}
        <a
          href={result.playlistUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="focus-ring surface-sunken elev-inset hover:surface-raised mt-4 inline-flex min-h-11 items-center gap-2 rounded-[var(--r-pill)] px-4 text-sm font-semibold text-[var(--foreground)]"
        >
          <ExternalLink aria-hidden="true" className="size-4" />
          Open in Spotify
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </Card>
    );
  }

  const needsConnection =
    result.status === "spotify-not-connected" ||
    result.status === "reconnect-required";

  return (
    <Card role="alert">
      <p className="text-sm leading-6 text-[var(--foreground)]">
        {result.message}
      </p>
      {needsConnection ? (
        // Both controls are real: the draft is kept either way, so declining
        // the permission has to be as easy as granting it.
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="accent"
            onClick={onReconnect}
            disabled={pending}
          >
            {pending
              ? "Redirecting to Spotify…"
              : result.status === "spotify-not-connected"
                ? "Connect Spotify"
                : "Reconnect Spotify"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onKeepEditing}
            disabled={pending}
          >
            Keep editing
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
