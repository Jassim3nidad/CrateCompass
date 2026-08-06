import type { CanonicalArtistWithDiscography } from "@/lib/providers/musicbrainz/client";
import type {
  ArtistSearchCandidate,
  ReleaseTrack,
  TaggedArtistCandidate,
} from "@/types/music";

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
  /**
   * Tag search is a MusicBrainz capability, deliberately on this port rather
   * than the discovery port: ListenBrainz has no equivalent, and putting it
   * behind `DiscoveryProvider` would misrepresent where the data comes from.
   */
  searchArtistsByTag(input: {
    readonly tag: string;
    readonly country?: string | undefined;
    readonly type?: string | undefined;
    readonly limit?: number | undefined;
  }): Promise<readonly TaggedArtistCandidate[]>;
  listReleaseGroupTracks(
    releaseGroupMbid: string,
  ): Promise<readonly ReleaseTrack[]>;
}
