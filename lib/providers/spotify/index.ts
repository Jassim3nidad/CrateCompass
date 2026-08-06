import "server-only";

import {
  addPlaylistItems,
  createPlaylist,
  search,
} from "@/lib/providers/spotify/client";
import type { SpotifyPort } from "@/lib/providers/spotify/port";
import { getAccessToken } from "@/lib/providers/spotify/token-manager";
import { areProviderFixturesEnabled } from "@/lib/providers/fixtures/enabled";
import { createFixtureSpotifyPort } from "@/lib/providers/fixtures/spotify";

/**
 * The one place the Spotify implementation is chosen.
 *
 * Same shape as the MusicBrainz and discovery factories: product code asks for
 * a port, and the substitution has a single seam that the environment schema
 * refuses to open outside a test environment.
 */
export function getSpotifyPort(): SpotifyPort {
  if (areProviderFixturesEnabled()) {
    return createFixtureSpotifyPort();
  }

  return { getAccessToken, search, createPlaylist, addPlaylistItems };
}
