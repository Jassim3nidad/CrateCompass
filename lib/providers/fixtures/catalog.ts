import type { CanonicalArtistWithDiscography } from "@/lib/providers/musicbrainz/client";
import {
  asMusicBrainzId,
  type ArtistSearchCandidate,
  type CanonicalArtist,
  type DiscographyRelease,
  type ReleaseTrack,
  type SourceAttribution,
  type TaggedArtistCandidate,
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
  /** 40 release groups: above the silent 25-group lookup cap. */
  prolific: "f1000000-0000-4000-8000-000000000005",
  /** Retrieval genuinely incomplete, so the partial signals are reachable. */
  cataloguePlaceholder: "f1000000-0000-4000-8000-000000000006",
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
  /**
   * MusicBrainz's own total, when it exceeds what retrieval could hold.
   *
   * Present only on the catalogue-placeholder fixture. Without an artist whose
   * retrieval is genuinely incomplete there is no way to exercise the partial
   * discography badge, and an indicator nothing tests is an indicator that can
   * silently stop rendering.
   */
  readonly declaredTotal?: number;
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

/**
 * A deliberately prolific artist: 40 release groups, above the 25 the
 * MusicBrainz lookup subquery silently caps at.
 *
 * Most are compilations and live records, mirroring what a real prolific
 * catalogue looks like — Nirvana's first 100 groups contain 52 compilations and
 * 3 plain studio albums. A fixture where every group were a studio album would
 * not have caught the truncation bug, because the first 25 would have looked
 * fine.
 */
const PROLIFIC_MBID = "f1000000-0000-4000-8000-000000000005";

const prolificArtist: FixtureArtist = {
  mbid: PROLIFIC_MBID,
  name: "Ledger Line Choir",
  sortName: "Ledger Line Choir",
  disambiguation: "prolific fixture artist",
  type: "Group",
  country: "GB",
  genres: ["post-rock"],
  tags: ["hazy"],
  releases: Array.from({ length: 40 }, (_, index) => {
    // The two plain studio albums sit at positions 30 and 35, past the cap, so
    // a truncated fetch finds neither.
    const isStudio = index === 30 || index === 35;

    return {
      mbid: `f3000000-0000-4000-8000-${String(500 + index).padStart(12, "0")}`,
      title: isStudio
        ? `Ledger Line Choir — Studio ${index}`
        : `Ledger Line Choir — Collection ${index}`,
      primaryType: "Album",
      secondaryTypes: isStudio ? [] : ["Compilation"],
      firstReleaseDate: `${1990 + index}`,
    };
  }),
};

/**
 * A catalogue placeholder, mirroring the "Various Artists" entity.
 *
 * That entity holds 288,991 release groups, so retrieval stops at the 10-page
 * safety bound and the list on screen is genuinely partial. This fixture exists
 * so the partial-discography badge, the "showing N of M" caption, and the
 * refusal to answer a counting question are all reachable in a browser test.
 */
const PLACEHOLDER_MBID = "f1000000-0000-4000-8000-000000000006";

const placeholderArtist: FixtureArtist = {
  mbid: PLACEHOLDER_MBID,
  name: "Assorted Performers",
  sortName: "Assorted Performers",
  disambiguation: "catalogue placeholder fixture",
  type: "Other",
  country: null,
  genres: [],
  tags: [],
  releases: Array.from({ length: 12 }, (_, index) => ({
    mbid: `f3000000-0000-4000-8000-${String(700 + index).padStart(12, "0")}`,
    title: `Assorted Performers — Volume ${index + 1}`,
    primaryType: "Album",
    secondaryTypes: ["Compilation"],
    firstReleaseDate: `${1990 + index}`,
  })),
  // Far beyond what was retrieved, exactly as the real placeholder behaves.
  declaredTotal: 288_991,
};

const artists: readonly FixtureArtist[] = [
  prolificArtist,
  placeholderArtist,
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

/**
 * Tag search over the invented catalogue.
 *
 * Includes a placeholder entity so the seed-ranking filter has something real
 * to remove, and gives the seed artist the highest tag count so ranking order
 * is observable rather than incidental.
 */
export function fixtureTagSearch(input: {
  readonly tag: string;
  readonly country?: string | undefined;
  readonly limit: number;
}): readonly TaggedArtistCandidate[] {
  const tag = input.tag.trim().toLowerCase();

  if (tag.length === 0) {
    return [];
  }

  const matches = artists.filter(
    (artist) =>
      [...artist.genres, ...artist.tags].some(
        (entry) => entry.toLowerCase() === tag,
      ) &&
      (input.country === undefined || artist.country === input.country),
  );

  const placeholder: TaggedArtistCandidate = {
    mbid: asMusicBrainzId("f9000000-0000-4000-8000-000000000001"),
    name: "Various Artists",
    sortName: "Various Artists",
    disambiguation: null,
    type: "Other",
    country: null,
    // Deliberately the top Lucene hit, exactly as the live probe found: this is
    // what the ranking filter exists to remove.
    searchScore: 100,
    tags: [{ name: input.tag, count: 99 }],
    attribution: attribution("f9000000-0000-4000-8000-000000000001", "artist"),
  };

  const scored: TaggedArtistCandidate[] = matches.map((artist, index) => ({
    mbid: asMusicBrainzId(artist.mbid),
    name: artist.name,
    sortName: artist.sortName,
    disambiguation: artist.disambiguation,
    type: artist.type,
    country: artist.country,
    searchScore: 90 - index,
    tags: [
      {
        name: input.tag,
        count: artist.mbid === MBID.harbourLanternGroup ? 40 : 5,
      },
    ],
    attribution: attribution(artist.mbid, "artist"),
  }));

  return [placeholder, ...scored].slice(0, input.limit);
}

/** Ordered tracks for a fixture release group. */
export function fixtureReleaseTracks(
  releaseGroupMbid: string,
): readonly ReleaseTrack[] {
  const owner = artists.find((artist) =>
    artist.releases.some((release) => release.mbid === releaseGroupMbid),
  );
  const release = owner?.releases.find(
    (entry) => entry.mbid === releaseGroupMbid,
  );

  if (!owner || !release) {
    return [];
  }

  return [1, 2, 3].map((position) => ({
    recordingMbid: asMusicBrainzId(
      `f5000000-0000-4000-8000-${releaseGroupMbid.slice(-9)}${position}`,
    ),
    title: `${release.title} — track ${position}`,
    position,
    mediumPosition: 1,
    lengthMs: 210_000 + position * 1000,
    releaseTitle: release.title,
    releaseGroupMbid: asMusicBrainzId(releaseGroupMbid),
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

  if (!artist) {
    return null;
  }

  const releases = toReleases(artist);
  const total = artist.declaredTotal ?? releases.length;

  return {
    artist: toCanonical(artist),
    releases,
    releaseGroupTotal: total,
    releasesComplete: total === releases.length,
  };
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
