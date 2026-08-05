import type { CanonicalArtistWithDiscography } from "@/lib/providers/musicbrainz/client";
import {
  asMusicBrainzId,
  type ArtistSearchCandidate,
  type CanonicalArtist,
  type DiscographyRelease,
  type SourceAttribution,
} from "@/types/music";

/**
 * A wholly invented catalogue.
 *
 * Every artist, release and identifier here is made up. That is a requirement,
 * not a shortcut: the compliance plan forbids automated tests from using real
 * provider data or a real Spotify account, and inventing the data outright
 * makes it impossible for a fixture to be mistaken for a provider record.
 *
 * The catalogue is shaped to cover the states the discovery UI must handle:
 * a name that resolves ambiguously, a seed with a full result set, a seed with
 * no similar artists at all, a seed whose provider call fails, and a candidate
 * whose metadata lookup fails while its relationship is still known.
 */

const MBID = {
  harbourLanternGroup: "f1000000-0000-4000-8000-000000000001",
  harbourLanternPerson: "f1000000-0000-4000-8000-000000000002",
  quietLedger: "f1000000-0000-4000-8000-000000000003",
  brokenSignal: "f1000000-0000-4000-8000-000000000004",
} as const;

/** The candidate whose MusicBrainz lookup always fails, for the partial state. */
export const UNRESOLVABLE_CANDIDATE_MBID =
  "f2000000-0000-4000-8000-000000000003";

/** Seeds with deliberately degenerate similarity results. */
export const FIXTURE_SEEDS = {
  full: MBID.harbourLanternGroup,
  noResults: MBID.quietLedger,
  providerDown: MBID.brokenSignal,
} as const;

function attribution(mbid: string, kind: "artist" | "release-group") {
  return {
    provenance: "musicbrainz",
    sourceUrl: `https://musicbrainz.org/${kind}/${mbid}`,
    retrievedAt: new Date().toISOString(),
  } satisfies SourceAttribution;
}

interface FixtureArtist {
  readonly mbid: string;
  readonly name: string;
  readonly sortName: string;
  readonly disambiguation: string | null;
  readonly type: string | null;
  readonly country: string | null;
  readonly genres: readonly string[];
  readonly tags: readonly string[];
  readonly releases: readonly {
    readonly mbid: string;
    readonly title: string;
    readonly primaryType: string | null;
    readonly secondaryTypes: readonly string[];
    readonly firstReleaseDate: string | null;
  }[];
}

const SIMILAR_NAMES = [
  "Ash Meridian",
  "Static Orchard",
  "Paper Tide",
  "Northern Ledger",
  "Glass Harbourmaster",
  "Low Tide Choir",
  "Signal Fire Club",
  "Amber Transit",
  "Winter Ferry",
  "Copper Almanac",
  "Hollow Beacon",
  "Salt Line Radio",
  "Evening Cartography",
  "Quiet Machinist",
] as const;

/**
 * Twelve page-one candidates plus three more, so "load more" has something to
 * load and the page-size boundary is actually exercised.
 */
const derivedCandidates: readonly FixtureArtist[] = SIMILAR_NAMES.map(
  (name, index) => ({
    mbid: `f2000000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`,
    name,
    sortName: name,
    disambiguation: index === 0 ? "Bristol-based duo" : null,
    type: index % 3 === 0 ? "Group" : "Person",
    country: index % 2 === 0 ? "GB" : "IE",
    genres: index % 2 === 0 ? ["dream pop"] : ["folktronica"],
    tags: index % 2 === 0 ? ["hazy", "coastal"] : ["acoustic"],
    releases: [
      {
        mbid: `f3000000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`,
        title: `${name} I`,
        primaryType: "Album",
        secondaryTypes: [],
        firstReleaseDate: `${2005 + index}`,
      },
    ],
  }),
);

const artists: readonly FixtureArtist[] = [
  {
    mbid: MBID.harbourLanternGroup,
    name: "Harbour Lantern",
    sortName: "Harbour Lantern",
    disambiguation: "Glasgow post-rock group",
    type: "Group",
    country: "GB",
    genres: ["post-rock", "dream pop"],
    tags: ["hazy", "instrumental", "coastal"],
    releases: [
      {
        mbid: "f3000000-0000-4000-8000-000000000101",
        title: "Slack Water",
        primaryType: "Album",
        secondaryTypes: [],
        firstReleaseDate: "2009-03-02",
      },
      {
        mbid: "f3000000-0000-4000-8000-000000000102",
        title: "Nightwatch Sessions",
        primaryType: "Album",
        secondaryTypes: ["Live"],
        firstReleaseDate: "2012",
      },
    ],
  },
  {
    mbid: MBID.harbourLanternPerson,
    name: "Harbour Lantern",
    sortName: "Lantern, Harbour",
    disambiguation: "Portland singer-songwriter",
    type: "Person",
    country: "US",
    genres: ["folk"],
    tags: ["acoustic"],
    releases: [],
  },
  {
    mbid: MBID.quietLedger,
    name: "Quiet Ledger",
    sortName: "Quiet Ledger",
    disambiguation: null,
    type: "Group",
    country: "GB",
    genres: ["ambient"],
    tags: [],
    releases: [],
  },
  {
    mbid: MBID.brokenSignal,
    name: "Broken Signal",
    sortName: "Broken Signal",
    disambiguation: null,
    type: "Group",
    country: "GB",
    genres: ["noise"],
    tags: [],
    releases: [],
  },
  {
    mbid: "f2000000-0000-4000-8000-000000000001",
    name: "Vellum Coast",
    sortName: "Vellum Coast",
    disambiguation: "Edinburgh quartet",
    type: "Group",
    country: "GB",
    // Overlaps the seed on two tags and adds two of its own, so shared and
    // differing evidence are both non-empty.
    genres: ["post-rock", "shoegaze"],
    tags: ["hazy", "reverb-heavy"],
    releases: [
      {
        mbid: "f3000000-0000-4000-8000-000000000201",
        title: "Tidal Frame",
        primaryType: "Album",
        secondaryTypes: [],
        firstReleaseDate: "2011-05-16",
      },
      {
        mbid: "f3000000-0000-4000-8000-000000000202",
        title: "Long Ferry",
        primaryType: "Album",
        secondaryTypes: [],
        firstReleaseDate: "2015-09-04",
      },
      {
        mbid: "f3000000-0000-4000-8000-000000000203",
        title: "Live at the Dry Dock",
        primaryType: "Album",
        secondaryTypes: ["Live"],
        firstReleaseDate: "2016",
      },
    ],
  },
  ...derivedCandidates,
];

const byMbid = new Map(artists.map((artist) => [artist.mbid, artist]));

function toCanonical(artist: FixtureArtist): CanonicalArtist {
  return {
    mbid: asMusicBrainzId(artist.mbid),
    name: artist.name,
    sortName: artist.sortName,
    disambiguation: artist.disambiguation,
    type: artist.type,
    country: artist.country,
    aliases: [],
    genres: artist.genres,
    tags: artist.tags,
    attribution: attribution(artist.mbid, "artist"),
  };
}

function toReleases(artist: FixtureArtist): readonly DiscographyRelease[] {
  return artist.releases.map((release) => ({
    mbid: asMusicBrainzId(release.mbid),
    title: release.title,
    primaryType: release.primaryType,
    secondaryTypes: release.secondaryTypes,
    firstReleaseDate: {
      value: release.firstReleaseDate,
      precision:
        release.firstReleaseDate === null
          ? "unknown"
          : release.firstReleaseDate.length === 4
            ? "year"
            : "day",
    },
    disambiguation: null,
    genres: [],
    tags: [],
    attribution: attribution(release.mbid, "release-group"),
  }));
}

export function fixtureSearch(
  query: string,
  limit: number,
): readonly ArtistSearchCandidate[] {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) {
    return [];
  }

  return artists
    .filter((artist) => artist.name.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((artist, index) => ({
      mbid: asMusicBrainzId(artist.mbid),
      name: artist.name,
      sortName: artist.sortName,
      disambiguation: artist.disambiguation,
      type: artist.type,
      country: artist.country,
      searchScore: 100 - index,
      attribution: attribution(artist.mbid, "artist"),
    }));
}

export function fixtureLookup(
  mbid: string,
): CanonicalArtistWithDiscography | null {
  const artist = byMbid.get(mbid);
  return artist
    ? { artist: toCanonical(artist), releases: toReleases(artist) }
    : null;
}

export interface FixtureSimilarRow {
  readonly mbid: string;
  readonly name: string;
  readonly disambiguation: string | null;
  readonly type: string | null;
  readonly score: number;
}

export function fixtureSimilarArtists(
  seedMbid: string,
): readonly FixtureSimilarRow[] {
  if (seedMbid !== FIXTURE_SEEDS.full) {
    return [];
  }

  const ordered = [
    byMbid.get("f2000000-0000-4000-8000-000000000001"),
    ...derivedCandidates,
  ].filter((artist): artist is FixtureArtist => artist !== undefined);

  return ordered.map((artist, index) => ({
    mbid: artist.mbid,
    name: artist.name,
    disambiguation: artist.disambiguation,
    type: artist.type,
    // A steep-then-shallow curve so the strength buckets are all represented.
    score: Math.max(40, 1000 - index * 120),
  }));
}
