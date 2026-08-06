import "server-only";

import {
  listReleaseGroupTracks,
  lookupArtist,
  searchArtists,
  searchArtistsByTag,
} from "@/lib/providers/musicbrainz/client";
import type { MusicBrainzPort } from "@/lib/providers/musicbrainz/port";
import {
  areProviderFixturesEnabled,
  createFixtureMusicBrainzPort,
} from "@/lib/providers/fixtures";

/**
 * The one place the MusicBrainz implementation is chosen.
 *
 * Product code calls `getMusicBrainzClient()` and never imports the client
 * module directly, so the fixture substitution has exactly one seam rather than
 * one per call site.
 */
export function getMusicBrainzClient(): MusicBrainzPort {
  if (areProviderFixturesEnabled()) {
    return createFixtureMusicBrainzPort();
  }

  return {
    searchArtists,
    lookupArtist,
    searchArtistsByTag,
    listReleaseGroupTracks,
  };
}
