import "server-only";

import type { SpotifyPort } from "@/lib/providers/spotify/port";
import {
  asSpotifyResourceId,
  asSpotifyUri,
  SpotifyProviderError,
} from "@/lib/providers/spotify/types";

/**
 * A fake Spotify for the end-to-end suite.
 *
 * Playlist creation is the only irreversible outward action in the product, so
 * it is the action most worth covering in a browser test — and the one that
 * absolutely may not touch a real account. This stands in for the four allowed
 * operations and records nothing outside the process.
 *
 * Shaped to exercise the honest-reporting paths rather than only the happy one:
 * a recording whose title contains `unmatchable` resolves to nothing, so a test
 * can reach the partial-creation state without contorting the fixture
 * catalogue.
 */

const UNMATCHABLE = /unmatchable/i;

let createdCount = 0;

/** Test-only: makes playlist identifiers predictable across a run. */
export function resetFixtureSpotifyForTesting(): void {
  createdCount = 0;
}

export function createFixtureSpotifyPort(): SpotifyPort {
  return {
    async getAccessToken() {
      // No connection row, no encryption, no refresh. A test that needs the
      // *connection* states covered has the unit suite for that.
      return "fixture-access-token";
    },

    async search(_accessToken, input) {
      const title = /track:"([^"]+)"/.exec(input.query)?.[1] ?? "";
      const artist = /artist:"([^"]+)"/.exec(input.query)?.[1] ?? "";

      if (title.length === 0 || UNMATCHABLE.test(title)) {
        return { artists: [], tracks: [] };
      }

      return {
        artists: [],
        tracks: [
          {
            id: asSpotifyResourceId(
              `fixture-track-${encodeURIComponent(title)}`,
            ),
            uri: asSpotifyUri(`spotify:track:${encodeURIComponent(title)}`),
            name: title,
            artistNames: [artist],
            isExplicit: false,
          },
        ],
      };
    },

    async createPlaylist(_accessToken, input) {
      if (input.name.trim().length === 0) {
        throw new SpotifyProviderError(
          "invalid-request",
          "Spotify rejected the request.",
        );
      }

      createdCount += 1;
      const id = `fixture-playlist-${createdCount}`;

      return {
        id: asSpotifyResourceId(id),
        uri: asSpotifyUri(`spotify:playlist:${id}`),
      };
    },

    async addPlaylistItems(_accessToken, input) {
      if (input.uris.length === 0) {
        throw new SpotifyProviderError(
          "invalid-request",
          "Spotify accepts between 1 and 100 items per request.",
        );
      }

      return `fixture-snapshot-${input.uris.length}`;
    },
  };
}
