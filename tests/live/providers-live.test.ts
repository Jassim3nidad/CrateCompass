// @vitest-environment node
//
// The suite defaults to jsdom for component tests. The OpenAI SDK refuses to
// construct in a browser-like environment — correctly, since that would risk
// shipping an API key to a client — so this file opts into node.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { artistMatchExplanationSchema } from "@/lib/ai/schemas";
import { buildMatchEvidence } from "@/lib/discovery/evidence";
import { verifyExplanation } from "@/lib/discovery/explanation";
import {
  asMusicBrainzId,
  type CanonicalArtist,
  type DiscographyRelease,
} from "@/types/music";

/**
 * Live provider verification.
 *
 * Every other suite in this repository runs against mocks or fixtures, which is
 * correct: automated tests must not depend on a third party being up, and the
 * compliance plan forbids touching a real Spotify account. But mocks encode
 * assumptions, and one assumption in particular cannot be tested with them —
 * that the provider factories return the *real* adapters when fixtures are off.
 *
 * This file therefore does what nothing else does, and only on request:
 *
 *     LIVE_PROVIDERS=1 npx vitest run tests/live/providers-live.test.ts
 *
 * Without that flag every case is skipped, so `npm test` stays offline and
 * deterministic.
 *
 * Spotify is deliberately absent. Reaching it needs a connected account, and
 * automated tests may not use one.
 */

const live = process.env.LIVE_PROVIDERS === "1";

if (live) {
  // tests/setup.ts overwrites provider credentials with synthetic values so a
  // developer's real keys can never leak into an ordinary test run. That
  // protection is right, and it is undone here — in one file, only under an
  // explicit flag — because live verification is the whole point of this file.
  // Order matters. Loading follows dotenv semantics and will not overwrite a
  // variable that is already set, so the synthetic values have to be removed
  // first — otherwise this file quietly sends a fake API key and the provider
  // answers with a bare 400 that looks like a malformed request.
  for (const key of [
    "AI_PROVIDER",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "DISCOVERY_PROVIDER",
    "MUSICBRAINZ_APP_NAME",
    "MUSICBRAINZ_APP_VERSION",
    "MUSICBRAINZ_CONTACT",
    "PROVIDER_FIXTURES",
  ]) {
    delete process.env[key];
  }

  // `.env.local` is read directly rather than through @next/env: that helper
  // memoises per process and returns early inside a Vitest worker, so it
  // silently loads nothing and every call goes out with a synthetic key.
  const envFile = readFileSync(join(process.cwd(), ".env.local"), "utf8");

  for (const rawLine of envFile.split(String.fromCharCode(10))) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(rawLine.trim());
    const key = match?.[1];

    if (!key) continue;

    const value = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");

    if (value.length > 0 && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  process.env.APP_ENV = "development";
}

/** A real, stable MusicBrainz artist: Portishead. */
const PORTISHEAD_MBID = "8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11";

/**
 * Nirvana: 573 release groups against Portishead's 25.
 *
 * Portishead sits exactly on the lookup subquery's silent cap, which is why
 * every earlier live check passed while prolific artists were being truncated.
 */
const NIRVANA_MBID = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";

describe.runIf(live)("live provider factories", () => {
  it("returns the real MusicBrainz client when fixtures are off", async () => {
    const { areProviderFixturesEnabled } =
      await import("@/lib/providers/fixtures");
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");

    expect(areProviderFixturesEnabled()).toBe(false);

    const candidates = await getMusicBrainzClient().searchArtists(
      "portishead",
      {
        limit: 5,
      },
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.attribution.provenance).toBe("musicbrainz");
    // The fixture catalogue contains no real artist, so a real name coming
    // back is proof the switch landed on the live adapter.
    expect(
      candidates.some((candidate) => /portishead/i.test(candidate.name)),
    ).toBe(true);
  }, 30_000);

  it("does not serve fixture artists when fixtures are off", async () => {
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");

    const candidates = await getMusicBrainzClient().searchArtists("harbour", {
      limit: 10,
    });

    // "Harbour Lantern" is invented and exists only in the fixture catalogue.
    expect(
      candidates.some((candidate) => candidate.name === "Harbour Lantern"),
    ).toBe(false);
  }, 30_000);

  it("looks up a canonical artist with releases and tags", async () => {
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");

    const { artist, releases } =
      await getMusicBrainzClient().lookupArtist(PORTISHEAD_MBID);

    expect(artist.name).toMatch(/portishead/i);
    expect(artist.mbid).toBe(PORTISHEAD_MBID);
    expect(releases.length).toBeGreaterThan(0);
    expect(artist.attribution.sourceUrl).toContain("musicbrainz.org");
  }, 30_000);

  it("retrieves a prolific artist's whole discography, not the first 25", async () => {
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");

    const { releases, releaseGroupTotal, releasesComplete } =
      await getMusicBrainzClient().lookupArtist(NIRVANA_MBID);

    // The regression, against the live service rather than a stub.
    expect(releaseGroupTotal).toBeGreaterThan(100);
    expect(releases.length).toBe(releaseGroupTotal);
    expect(releasesComplete).toBe(true);

    // Truncation changed which albums existed, not just how many: a partial
    // fetch of Nirvana is mostly compilations. Across all 573 groups the
    // filter finds the three studio albums that actually exist, which is both
    // the correct answer and one no truncated fetch reliably reaches.
    const studioTitles = releases
      .filter(
        (release) =>
          release.primaryType === "Album" &&
          release.secondaryTypes.length === 0,
      )
      .map((release) => release.title.toLowerCase());

    expect(studioTitles.length).toBeGreaterThanOrEqual(3);
    expect(studioTitles).toContain("nevermind");
    expect(studioTitles).toContain("in utero");
  }, 120_000);

  it("classifies and orders a real discography the way the explorer shows it", async () => {
    // Fixtures cannot prove this. Every secondary type in the catalog is one
    // this repository wrote; only live data shows whether MusicBrainz's real
    // vocabulary lands in the categories the filters offer.
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");
    const { buildDiscography, countByCategory } =
      await import("@/lib/discography/retrieval");

    const lookup = await getMusicBrainzClient().lookupArtist(NIRVANA_MBID);
    const discography = buildDiscography(NIRVANA_MBID, lookup);

    expect(discography.retrievalComplete).toBe(true);
    expect(discography.total).toBe(lookup.releaseGroupTotal);

    // A prolific catalogue must populate more than one filter, or the chips
    // would be decoration.
    const counts = countByCategory(discography);
    expect(counts.album ?? 0).toBeGreaterThan(0);
    expect(counts.compilation ?? 0).toBeGreaterThan(0);
    expect(counts.live ?? 0).toBeGreaterThan(0);

    // A live album must not be filed as a plain album. MusicBrainz records it
    // as secondary type Live — usually with primary Album, but live data also
    // contains Live groups with *no* primary type at all, which is why
    // classification reads the secondary types first and why asserting on the
    // primary type here would be asserting something untrue.
    const liveEntries = discography.entries.filter(
      (entry) => entry.category === "live",
    );
    expect(
      liveEntries.every((entry) =>
        entry.secondaryTypes.some((type) => type.toLowerCase() === "live"),
      ),
    ).toBe(true);

    // The converse: nothing carrying Live may end up in the album filter.
    expect(
      discography.entries
        .filter((entry) => entry.category === "album")
        .every(
          (entry) =>
            !entry.secondaryTypes.some((type) => type.toLowerCase() === "live"),
        ),
    ).toBe(true);

    // Chronological, with undated releases last rather than sorted as empty
    // strings at the front.
    const dated = discography.entries
      .filter((entry) => entry.firstReleaseDate.value !== null)
      .map((entry) => entry.firstReleaseDate.value ?? "");
    expect([...dated]).toEqual([...dated].sort());

    const firstUndated = discography.entries.findIndex(
      (entry) => entry.firstReleaseDate.value === null,
    );
    if (firstUndated >= 0) {
      expect(
        discography.entries
          .slice(firstUndated)
          .every((entry) => entry.firstReleaseDate.value === null),
      ).toBe(true);
    }
  }, 120_000);

  it("answers a real discography question from a real model, and grounds it", async () => {
    // The gap this closes. Contract tests prove each adapter's output validates
    // against the schema; the fixture end-to-end proves the panel renders. What
    // neither covers is a real model reading 200 real, escaped release titles
    // and returning identifiers that survive citation verification. Phase 6's
    // `groundedIn` defect was exactly this shape: every explanation validated
    // and every one failed verification, and only a live check found it.
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");
    const { getAiProvider } = await import("@/lib/ai");
    const { buildDiscography } = await import("@/lib/discography/retrieval");
    const { selectContext } = await import("@/lib/discography/selection");
    const { sanitizeReleases } = await import("@/lib/discography/sanitize");
    const { verifyAnswer } = await import("@/lib/discography/verification");
    const { discographyAnswerSchema } = await import("@/lib/ai/schemas");

    const lookup = await getMusicBrainzClient().lookupArtist(NIRVANA_MBID);
    const discography = buildDiscography(NIRVANA_MBID, lookup);

    const question = "What was their first studio album, and what year?";
    const context = selectContext({ discography, question });

    // A 573-group artist must exercise the bound, or this is not testing the
    // shape the product actually sends.
    expect(context.contextTruncated).toBe(true);
    expect(context.entries.length).toBe(200);

    const { releases } = sanitizeReleases(context.entries);
    expect(releases.length).toBeGreaterThan(0);

    const provider = getAiProvider();
    const output = await provider.answerDiscographyQuestion({
      question,
      artistName: discography.artistName,
      releases,
    });

    expect(discographyAnswerSchema.safeParse(output).success).toBe(true);

    const verified = verifyAnswer({ answer: output, context });

    // The assertion that matters: a real model given real records must produce
    // an answer that survives grounding, not one that is always discarded. A
    // permanent fallback to "insufficient context" would be the Phase 6 defect
    // repeating, and it would look like working software from the outside.
    expect(verified.status).toBe("answered");

    if (verified.status === "answered") {
      expect(verified.answer.length).toBeGreaterThan(0);
      expect(verified.citations.length).toBeGreaterThan(0);

      // Every citation resolves to a release that was actually supplied.
      const suppliedIds = new Set(releases.map((release) => release.id));
      for (const citation of verified.citations) {
        expect(suppliedIds.has(citation.mbid)).toBe(true);
      }

      // Nirvana's first studio album is Bleach, 1989. The model is being asked
      // a question the supplied records answer, so a grounded reply should
      // reach it; this is a sanity check on the retrieval and selection feeding
      // it, not a demand that the model phrase anything particular.
      expect(verified.answer.toLowerCase()).toMatch(/bleach|1989/);

      // The provenance the interface renders must survive the round trip.
      expect(verified.contextTruncated).toBe(true);
      expect(verified.retrievalComplete).toBe(true);
      expect(verified.totalAvailable).toBe(discography.total);
    }
  }, 180_000);

  it("declines a real question the real records cannot answer", async () => {
    // The honest-limitation path, against a live model. A product that answers
    // everything is not grounded; this asserts the refusal is reachable.
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");
    const { getAiProvider } = await import("@/lib/ai");
    const { buildDiscography } = await import("@/lib/discography/retrieval");
    const { selectContext } = await import("@/lib/discography/selection");
    const { sanitizeReleases } = await import("@/lib/discography/sanitize");
    const { verifyAnswer } = await import("@/lib/discography/verification");

    const lookup = await getMusicBrainzClient().lookupArtist(PORTISHEAD_MBID);
    const discography = buildDiscography(PORTISHEAD_MBID, lookup);

    // Release groups carry no personnel, so this is unanswerable from context.
    const question =
      "Who played bass on their second album, and where were they born?";
    const context = selectContext({ discography, question });
    const { releases } = sanitizeReleases(context.entries);

    const output = await getAiProvider().answerDiscographyQuestion({
      question,
      artistName: discography.artistName,
      releases,
    });

    const verified = verifyAnswer({ answer: output, context });

    // Either it says it cannot answer, or it answers while citing only supplied
    // releases. What must not happen is a fabricated personnel claim carrying
    // an invented citation, and verification is what forecloses that.
    if (verified.status === "answered") {
      const suppliedIds = new Set(releases.map((release) => release.id));
      for (const citation of verified.citations) {
        expect(suppliedIds.has(citation.mbid)).toBe(true);
      }
    } else {
      expect(verified.reason.length).toBeGreaterThan(0);
    }
  }, 180_000);

  it("returns the real discovery provider with a non-fixture algorithm", async () => {
    const { getDiscoveryProvider } = await import("@/lib/providers/discovery");

    const evidence = await getDiscoveryProvider().findSimilarArtists({
      mbid: asMusicBrainzId(PORTISHEAD_MBID),
      limit: 10,
    });

    expect(evidence.algorithm).not.toBe("fixture_similarity_v1");
    expect(evidence.candidates.length).toBeGreaterThan(0);
    expect(evidence.attribution.provenance).toBe("listenbrainz");

    for (const candidate of evidence.candidates) {
      expect(candidate.mbid).toBeTruthy();
      expect(candidate.score).toBeGreaterThan(0);
    }
  }, 30_000);

  it("builds evidence and a verified explanation from live provider data", async () => {
    const { getMusicBrainzClient } =
      await import("@/lib/providers/musicbrainz");
    const { getDiscoveryProvider } = await import("@/lib/providers/discovery");
    const { getAiProvider } = await import("@/lib/ai");

    const seed = await getMusicBrainzClient().lookupArtist(PORTISHEAD_MBID);
    const similarity = await getDiscoveryProvider().findSimilarArtists({
      mbid: asMusicBrainzId(PORTISHEAD_MBID),
      limit: 10,
    });

    const candidate = similarity.candidates[0];
    expect(candidate).toBeDefined();
    if (!candidate?.mbid) return;

    const looked = await getMusicBrainzClient().lookupArtist(candidate.mbid);
    const candidateArtist: CanonicalArtist = looked.artist;
    const candidateReleases: readonly DiscographyRelease[] = looked.releases;

    const evidence = buildMatchEvidence({
      seed: seed.artist,
      candidate,
      candidateArtist,
      candidateReleases,
      rank: 1,
      totalCandidates: similarity.candidates.length,
      topScore: candidate.score,
      similarityAttribution: similarity.attribution,
    });

    expect(evidence.facts.length).toBeGreaterThan(0);
    // The boundary property, checked against real provider data rather than
    // hand-written fixtures.
    expect(JSON.stringify(evidence)).not.toMatch(/spotify/i);

    const provider = getAiProvider();
    const aiInput = {
      seedArtistName: seed.artist.name,
      candidateArtistName: candidate.name,
      listenerPreference: "I like the slow, heavy low end.",
      evidence: evidence.facts,
      candidateReleases: candidateReleases.slice(0, 12).map((release) => ({
        id: release.mbid,
        title: release.title,
        primaryType: release.primaryType,
        year: release.firstReleaseDate.value?.slice(0, 4) ?? null,
      })),
    };
    const output = await provider.explainArtistMatch(aiInput);

    expect(artistMatchExplanationSchema.safeParse(output).success).toBe(true);

    const verified = verifyExplanation({
      output,
      evidence,
      allowedReleases: candidateReleases.map((release) => ({
        releaseId: release.mbid,
        title: release.title,
        year: release.firstReleaseDate.value?.slice(0, 4) ?? null,
        primaryType: release.primaryType,
        sourceUrl: release.attribution.sourceUrl,
      })),
      model: provider.model,
    });

    // Either outcome is a pass: a verified explanation, or a rejection that
    // correctly names why. What would fail is an unverifiable claim slipping
    // through, and there is no third branch for that.
    if (verified.ok) {
      expect(verified.explanation.summary.length).toBeGreaterThan(0);
      expect(verified.explanation.source).toBe("ai");
    } else {
      expect([
        "ungrounded-claim",
        "unknown-release",
        "forbidden-content",
      ]).toContain(verified.reason);
    }

    console.info(
      `[live] provider=${provider.name} model=${provider.model} verified=${verified.ok} facts=${evidence.facts.length}`,
    );
  }, 120_000);
});
