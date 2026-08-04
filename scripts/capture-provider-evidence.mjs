/**
 * Captures real MusicBrainz and ListenBrainz responses as contract evidence.
 *
 * Every adapter in this repository was built against hand-written mocks, which
 * can silently encode wrong assumptions about shape, nullability and error
 * bodies. This script calls the live services and records raw request/response
 * pairs to tests/fixtures/provider-evidence.json.
 *
 * The companion suite (tests/contract/provider-contract.test.ts) replays that
 * file through the adapters' real schemas, so drift between what the providers
 * send and what we parse fails CI rather than production.
 *
 * Usage: node scripts/capture-provider-evidence.mjs
 *
 * MusicBrainz allows one request per second, so this takes about a minute.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(projectRoot);

const contact = process.env.MUSICBRAINZ_CONTACT;
if (!contact) {
  console.error("MUSICBRAINZ_CONTACT must be set before capturing evidence.");
  process.exit(1);
}

const USER_AGENT = `${process.env.MUSICBRAINZ_APP_NAME ?? "CrateCompass"}/${
  process.env.MUSICBRAINZ_APP_VERSION ?? "0.1.0"
} ( ${contact} )`;

const MB_ORIGIN = "https://musicbrainz.org";
const LABS_ORIGIN = "https://labs.api.listenbrainz.org";
const SIMILARITY_ALGORITHM =
  process.env.LISTENBRAINZ_SIMILARITY_ALGORITHM ??
  "session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deliberately varied: exact, ambiguous, punctuation, non-Latin, absent. */
const ARTIST_QUERIES = [
  { label: "exact-match", query: "Portishead" },
  { label: "ambiguous-name", query: "Nirvana" },
  { label: "diacritics", query: "Björk" },
  { label: "punctuation-slash", query: "AC/DC" },
  { label: "punctuation-only", query: "!!!" },
  { label: "punctuation-parens", query: "Sunn O)))" },
  { label: "leading-article", query: "The Beatles" },
  { label: "long-with-punctuation", query: "Godspeed You! Black Emperor" },
  { label: "non-latin-japanese", query: "坂本龍一" },
  { label: "non-latin-cyrillic", query: "Кино" },
  { label: "nonexistent", query: "zzzznonexistentartistxyzq" },
];

/** Popular, obscure, and special-character artists for the Labs endpoint. */
const SIMILARITY_SEEDS = [
  { label: "popular", mbid: "a74b1b7f-71a5-4011-9441-d0b5e4122711" }, // Radiohead
  { label: "moderate", mbid: "8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11" }, // Portishead
  { label: "special-characters", mbid: "87c5dedd-371d-4a53-9f7f-80522fb7f3cb" }, // Björk
  { label: "nonexistent-mbid", mbid: "00000000-0000-0000-0000-000000000000" },
];

const evidence = {
  capturedAt: new Date().toISOString(),
  userAgent: USER_AGENT.replace(contact, "<redacted-contact>"),
  musicBrainzSearch: [],
  musicBrainzLookup: [],
  listenBrainzSimilarArtists: [],
  errorResponses: [],
};

async function capture(url, headers) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    let body;
    let parseError = null;

    try {
      body = JSON.parse(text);
    } catch (error) {
      body = text.slice(0, 500);
      parseError = String(error);
    }

    return {
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      contentType: response.headers.get("content-type"),
      rateLimitHeaders: {
        retryAfter: response.headers.get("retry-after"),
        limit: response.headers.get("x-ratelimit-limit"),
        remaining: response.headers.get("x-ratelimit-remaining"),
        resetIn: response.headers.get("x-ratelimit-reset-in"),
      },
      parseError,
      body,
    };
  } catch (error) {
    return {
      status: null,
      ok: false,
      durationMs: Date.now() - startedAt,
      transportError: String(error),
      body: null,
    };
  }
}

const mbHeaders = { "User-Agent": USER_AGENT, Accept: "application/json" };

console.log("Capturing MusicBrainz artist searches...");
for (const { label, query } of ARTIST_QUERIES) {
  const url = `${MB_ORIGIN}/ws/2/artist?query=${encodeURIComponent(query)}&limit=5&fmt=json`;
  const result = await capture(url, mbHeaders);

  evidence.musicBrainzSearch.push({ label, query, url, result });
  console.log(`  ${label.padEnd(24)} ${result.status} ${result.durationMs}ms`);

  await sleep(1100); // MusicBrainz: one request per second.
}

console.log("Capturing MusicBrainz artist lookups...");
const lookupMbids = evidence.musicBrainzSearch
  .filter((entry) => entry.result.ok && entry.result.body?.artists?.[0]?.id)
  .slice(0, 6)
  .map((entry) => ({
    label: entry.label,
    mbid: entry.result.body.artists[0].id,
  }));

for (const { label, mbid } of lookupMbids) {
  const url = `${MB_ORIGIN}/ws/2/artist/${mbid}?inc=aliases+release-groups+genres+tags&fmt=json`;
  const result = await capture(url, mbHeaders);

  evidence.musicBrainzLookup.push({ label, mbid, url, result });
  console.log(`  ${label.padEnd(24)} ${result.status} ${result.durationMs}ms`);

  await sleep(1100);
}

console.log("Capturing MusicBrainz error responses...");
for (const [label, url] of [
  [
    "not-found-mbid",
    `${MB_ORIGIN}/ws/2/artist/00000000-0000-0000-0000-000000000000?fmt=json`,
  ],
  ["malformed-mbid", `${MB_ORIGIN}/ws/2/artist/not-a-uuid?fmt=json`],
]) {
  const result = await capture(url, mbHeaders);
  evidence.errorResponses.push({ provider: "musicbrainz", label, url, result });
  console.log(`  ${label.padEnd(24)} ${result.status}`);
  await sleep(1100);
}

console.log("Capturing ListenBrainz Labs similar artists...");
for (const { label, mbid } of SIMILARITY_SEEDS) {
  const url = `${LABS_ORIGIN}/similar-artists/json?artist_mbids=${mbid}&algorithm=${SIMILARITY_ALGORITHM}`;
  const result = await capture(url, { Accept: "application/json" });

  evidence.listenBrainzSimilarArtists.push({ label, mbid, url, result });
  console.log(
    `  ${label.padEnd(24)} ${result.status} ${result.durationMs}ms ` +
      `${Array.isArray(result.body) ? `${result.body.length} rows` : "non-array"}`,
  );

  await sleep(500);
}

console.log("Capturing ListenBrainz Labs error responses...");
for (const [label, url] of [
  ["missing-parameters", `${LABS_ORIGIN}/similar-artists/json`],
  [
    "unknown-algorithm",
    `${LABS_ORIGIN}/similar-artists/json?artist_mbids=8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11&algorithm=not_a_real_algorithm`,
  ],
]) {
  const result = await capture(url, { Accept: "application/json" });
  evidence.errorResponses.push({
    provider: "listenbrainz",
    label,
    url,
    result,
  });
  console.log(`  ${label.padEnd(24)} ${result.status}`);
  await sleep(500);
}

const outputPath = join(
  projectRoot,
  "tests",
  "fixtures",
  "provider-evidence.json",
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(`\nWrote evidence to ${outputPath}`);
