import type { SpotifySearchResult } from "@/lib/providers/spotify/client";
import type {
  SpotifyResourceId,
  SpotifyUri,
} from "@/lib/providers/spotify/types";

/**
 * The Spotify operations playlist creation depends on.
 *
 * Creation previously imported the client and the token manager directly, which
 * made the one irreversible outward action in the product impossible to drive
 * from an end-to-end test: reaching it needed a real connected account, which
 * the compliance plan forbids automated tests from using.
 *
 * The port is exactly the four operations already on the endpoint allowlist —
 * it adds no new capability, it just makes the existing ones substitutable.
 */
export interface SpotifyPort {
  getAccessToken(userId: string): Promise<string>;
  search(
    accessToken: string,
    input: {
      readonly query: string;
      readonly types: readonly ("artist" | "track")[];
      readonly limit?: number;
    },
  ): Promise<SpotifySearchResult>;
  createPlaylist(
    accessToken: string,
    input: {
      readonly name: string;
      readonly description?: string | null;
      readonly isPublic?: boolean;
    },
  ): Promise<{ readonly id: SpotifyResourceId; readonly uri: SpotifyUri }>;
  addPlaylistItems(
    accessToken: string,
    input: {
      readonly playlistId: SpotifyResourceId;
      readonly uris: readonly SpotifyUri[];
    },
  ): Promise<string>;
}
