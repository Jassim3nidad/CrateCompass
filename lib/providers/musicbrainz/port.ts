import type { CanonicalArtistWithDiscography } from "@/lib/providers/musicbrainz/client";
import type { ArtistSearchCandidate } from "@/types/music";

/**
 * Provider-neutral metadata port.
 *
 * Product services depend on this rather than importing the client directly,
 * for the same reason the discovery port exists: the implementation is
 * selected once, in one factory, so a fixture implementation can be
 * substituted for tests without any product module knowing.
 */
export interface MusicBrainzPort {
  searchArtists(
    query: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ArtistSearchCandidate[]>;
  lookupArtist(mbid: string): Promise<CanonicalArtistWithDiscography>;
}
