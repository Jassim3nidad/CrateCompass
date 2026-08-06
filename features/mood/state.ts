import type { MoodCriteria } from "@/lib/ai/schemas";
import type { ControlSummary, PlaylistControls } from "@/lib/mood/controls";

/**
 * The vocabulary shared between the mood server actions and the components
 * that call them.
 *
 * Nothing here holds a Spotify value. Spotify appears once, at creation time,
 * behind `features/playlists`, and its outcome comes back as a separate type.
 */

export interface SeedOption {
  readonly mbid: string;
  readonly name: string;
  readonly disambiguation: string | null;
  readonly type: string | null;
  readonly country: string | null;
  /** Community votes for the searched tag; 0 when none are recorded. */
  readonly tagVotes: number;
  /** True when this was ordered by text relevance for want of tag data. */
  readonly rankedByRelevanceOnly: boolean;
}

export type MoodParseResult =
  | {
      readonly status: "clarify";
      readonly question: string;
      readonly criteria: MoodCriteria;
    }
  | {
      readonly status: "ready";
      readonly criteria: MoodCriteria;
      readonly summary: readonly ControlSummary[];
      readonly tags: readonly string[];
      readonly seeds: readonly SeedOption[];
      /** Present when no MusicBrainz tag matched the parsed genres. */
      readonly emptyReason: string | null;
      readonly inputDisclosure: string | null;
    }
  | {
      readonly status: "failed";
      readonly message: string;
    };

export interface DraftTrack {
  readonly id: string;
  readonly position: number;
  readonly recordingMbid: string;
  readonly title: string;
  readonly artistMbid: string;
  readonly artistName: string;
  readonly releaseTitle: string | null;
}

export type DraftResult =
  | {
      readonly status: "ready";
      readonly playlistId: string;
      readonly title: string;
      readonly description: string;
      readonly tracks: readonly DraftTrack[];
      readonly controls: PlaylistControls;
      /** Artists the expansion reached but could not supply tracks for. */
      readonly artistsWithoutTracks: readonly string[];
      /** True when fewer tracks were found than the requested length. */
      readonly isShort: boolean;
    }
  | {
      readonly status: "failed";
      readonly message: string;
    };

export type CreationResult =
  | {
      readonly status: "created";
      readonly playlistUrl: string;
      readonly trackTotal: number;
      readonly tracksAdded: number;
    }
  | {
      /** The playlist exists in Spotify but not every track reached it. */
      readonly status: "partial";
      readonly playlistUrl: string;
      readonly trackTotal: number;
      readonly tracksAdded: number;
      readonly unresolved: readonly string[];
      readonly message: string;
    }
  | {
      /** A previous identical submission already created this playlist. */
      readonly status: "already-created";
      readonly playlistUrl: string;
      readonly trackTotal: number;
      readonly tracksAdded: number;
    }
  | { readonly status: "auth-required"; readonly message: string }
  | { readonly status: "spotify-not-connected"; readonly message: string }
  | { readonly status: "reconnect-required"; readonly message: string }
  | { readonly status: "in-progress"; readonly message: string }
  | { readonly status: "failed"; readonly message: string };
