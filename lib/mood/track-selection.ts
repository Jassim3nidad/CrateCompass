import { matchesDecades, type PlaylistControls } from "@/lib/mood/controls";
import type { DiscographyRelease, ReleaseTrack } from "@/types/music";

/**
 * Choosing which tracks represent an artist.
 *
 * There is no popularity signal available. The ListenBrainz popularity API
 * exists but answers `500 — "Popularity API currently disabled due to high
 * load"`, and Spotify's own ranking is not permitted to select content. So
 * this makes a defensible choice rather than a ranked one, and the interface
 * says which album each track came from instead of implying a "best of".
 *
 * The rules, in order:
 *
 * 1. Only studio release groups — no live albums, compilations, remixes or
 *    soundtracks. The same rule Phase 6 uses to suggest a starting point.
 * 2. Only releases whose year satisfies the era control, when one is set.
 * 3. Opening tracks first. On a studio album the first track is the one the
 *    artist chose to open with, which is a real editorial signal and the only
 *    one available here.
 * 4. At most `maxPerArtist`, so one prolific artist cannot fill the playlist.
 */

/** Secondary types that mean "not a studio album". */
const NON_STUDIO_TYPES = new Set([
  "live",
  "compilation",
  "remix",
  "soundtrack",
  "dj-mix",
  "mixtape/street",
  "demo",
  "interview",
  "spokenword",
  "audiobook",
]);

export function isStudioAlbum(release: DiscographyRelease): boolean {
  if (release.primaryType !== "Album") return false;

  return !release.secondaryTypes.some((type) =>
    NON_STUDIO_TYPES.has(type.trim().toLowerCase()),
  );
}

export function selectStudioReleases(input: {
  readonly releases: readonly DiscographyRelease[];
  readonly controls: PlaylistControls;
  readonly limit: number;
}): readonly DiscographyRelease[] {
  return input.releases
    .filter(
      (release) =>
        isStudioAlbum(release) &&
        release.firstReleaseDate.value !== null &&
        matchesDecades(
          release.firstReleaseDate.value.slice(0, 4),
          input.controls.decades,
        ),
    )
    .sort((first, second) =>
      (first.firstReleaseDate.value ?? "").localeCompare(
        second.firstReleaseDate.value ?? "",
      ),
    )
    .slice(0, input.limit);
}

export interface TrackCandidateDraft {
  readonly recordingMbid: string;
  readonly title: string;
  readonly artistMbid: string;
  readonly artistName: string;
  readonly releaseTitle: string;
  readonly releaseYear: string | null;
  readonly lengthMs: number | null;
}

export function selectArtistTracks(input: {
  readonly artistMbid: string;
  readonly artistName: string;
  readonly tracks: readonly ReleaseTrack[];
  readonly releaseYear: string | null;
  readonly maxTracks: number;
}): readonly TrackCandidateDraft[] {
  return [...input.tracks]
    .sort((first, second) => {
      if (first.mediumPosition !== second.mediumPosition) {
        return first.mediumPosition - second.mediumPosition;
      }
      return first.position - second.position;
    })
    .slice(0, Math.max(0, input.maxTracks))
    .map((track) => ({
      recordingMbid: track.recordingMbid,
      title: track.title,
      artistMbid: input.artistMbid,
      artistName: input.artistName,
      releaseTitle: track.releaseTitle,
      releaseYear: input.releaseYear,
      lengthMs: track.lengthMs,
    }));
}

/**
 * Removes tracks that would read as duplicates in a playlist.
 *
 * Distinct recording MBIDs are not enough: an artist's studio albums routinely
 * contain a track and its later re-recording under the same title, and a
 * listener seeing the same name twice reads it as a bug.
 */
export function dedupeTracks(
  drafts: readonly TrackCandidateDraft[],
): readonly TrackCandidateDraft[] {
  const seenRecordings = new Set<string>();
  const seenTitles = new Set<string>();
  const kept: TrackCandidateDraft[] = [];

  for (const draft of drafts) {
    const titleKey = `${draft.artistMbid}:${draft.title.trim().toLowerCase()}`;

    if (seenRecordings.has(draft.recordingMbid) || seenTitles.has(titleKey)) {
      continue;
    }

    seenRecordings.add(draft.recordingMbid);
    seenTitles.add(titleKey);
    kept.push(draft);
  }

  return kept;
}

/**
 * Interleaves tracks so consecutive entries come from different artists.
 *
 * Without this a playlist is artist-blocked: three tracks by one act, then
 * three by the next. Round-robin ordering is what makes it read as a playlist
 * rather than a queue of albums.
 */
export function interleaveByArtist(
  drafts: readonly TrackCandidateDraft[],
): readonly TrackCandidateDraft[] {
  const byArtist = new Map<string, TrackCandidateDraft[]>();

  for (const draft of drafts) {
    const existing = byArtist.get(draft.artistMbid);
    if (existing) {
      existing.push(draft);
    } else {
      byArtist.set(draft.artistMbid, [draft]);
    }
  }

  const queues = [...byArtist.values()];
  const ordered: TrackCandidateDraft[] = [];
  let index = 0;

  while (ordered.length < drafts.length) {
    let placed = false;

    for (const queue of queues) {
      const next = queue[index];
      if (next) {
        ordered.push(next);
        placed = true;
      }
    }

    if (!placed) break;
    index += 1;
  }

  return ordered;
}
