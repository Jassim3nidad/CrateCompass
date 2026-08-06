import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { redactSensitive } from "@/lib/observability/logger";

/**
 * Static compliance checks.
 *
 * These assert properties of the repository rather than of a single function,
 * so an accidental reintroduction fails the suite instead of surviving until
 * review. They are the repository-scan half of the enforcement described in
 * docs/architecture/provider-boundaries.md.
 */

const projectRoot = join(import.meta.dirname, "..", "..");
const scannedRoots = ["app", "components", "features", "lib"];
const ignoredDirectories = new Set(["node_modules", ".next", "dist"]);

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry)) continue;

    const absolute = join(directory, entry);

    if (statSync(absolute).isDirectory()) {
      files.push(...collectSourceFiles(absolute));
      continue;
    }

    if (/\.tsx?$/.test(entry)) {
      files.push(absolute);
    }
  }

  return files;
}

const sourceFiles = scannedRoots.flatMap((root) =>
  collectSourceFiles(join(projectRoot, root)),
);

function readSource(file: string): { path: string; contents: string } {
  return {
    path: relative(projectRoot, file).split(sep).join("/"),
    contents: readFileSync(file, "utf8"),
  };
}

const sources = sourceFiles.map(readSource);

describe("repository scan", () => {
  it("finds source files to scan", () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it("keeps AI modules free of Spotify imports", () => {
    const offenders = sources
      .filter((source) => source.path.startsWith("lib/ai/"))
      .filter((source) =>
        /from\s+["'][^"']*providers\/spotify/.test(source.contents),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("keeps Spotify modules free of AI imports", () => {
    const offenders = sources
      .filter((source) => source.path.startsWith("lib/providers/spotify/"))
      .filter((source) => /from\s+["'][^"']*\/ai\//.test(source.contents))
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("reads the Spotify client secret nowhere, because PKCE never needs it", () => {
    const offenders = sources
      .filter((source) => source.contents.includes("SPOTIFY_CLIENT_SECRET"))
      .map((source) => source.path);

    // ADR 0002: the variable stays documented in .env.example so the decision
    // is reversible, but no application module may read it.
    expect(offenders).toEqual([]);
  });

  it("reads the Last.fm API key nowhere, because ADR 0003 selected ListenBrainz", () => {
    const offenders = sources
      .filter((source) => source.contents.includes("LASTFM_API_KEY"))
      .map((source) => source.path);

    // Last.fm is unimplemented on purpose: its terms prohibit sub-licensing its
    // data to a third party, which makes sending evidence to an AI provider
    // legally ambiguous. An accidental integration should fail here.
    expect(offenders).toEqual([]);
  });

  it("never imports a Spotify provider module from a client component", () => {
    const offenders = sources
      .filter((source) => /^\s*["']use client["']/m.test(source.contents))
      .filter((source) =>
        /from\s+["'][^"']*providers\/spotify/.test(source.contents),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("never imports the token encryption module from a client component", () => {
    const offenders = sources
      .filter((source) => /^\s*["']use client["']/m.test(source.contents))
      .filter((source) =>
        /from\s+["'][^"']*security\/(token-encryption|encryption-keys)/.test(
          source.contents,
        ),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("guards every Spotify provider module with server-only", () => {
    const unguarded = sources
      .filter((source) => source.path.startsWith("lib/providers/spotify/"))
      .filter((source) => source.path !== "lib/providers/spotify/types.ts")
      .filter((source) => !source.contents.includes('import "server-only"'))
      .map((source) => source.path);

    expect(unguarded).toEqual([]);
  });

  it("keeps playlist creation free of AI imports", () => {
    // The counterpart of the discovery rule: the module that talks to Spotify
    // must not be able to reach an AI provider, so a resolved track cannot
    // travel to one even by mistake.
    const offenders = sources
      .filter((source) => source.path.startsWith("features/playlists/"))
      .filter((source) =>
        /from\s+["'][^"']*\/ai(\/|["'])/.test(source.contents),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("keeps mood modules free of Spotify imports", () => {
    const offenders = sources
      .filter(
        (source) =>
          source.path.startsWith("lib/mood/") ||
          source.path.startsWith("features/mood/"),
      )
      .filter((source) =>
        /from\s+["'][^"']*providers\/spotify/.test(source.contents),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("keeps discovery evidence modules free of Spotify imports", () => {
    // Discovery is where AI input is assembled. If a Spotify module were
    // reachable from here, the boundary would depend on the code inside these
    // files rather than on the shape of the module graph.
    const offenders = sources
      .filter(
        (source) =>
          source.path.startsWith("lib/discovery/") ||
          source.path.startsWith("features/discovery/"),
      )
      .filter((source) =>
        /from\s+["'][^"']*providers\/spotify/.test(source.contents),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("keeps the Spotify feature module free of AI imports", () => {
    // The counterpart of the rule above: Spotify resolution may import
    // MusicBrainz for canonical names, but never an AI module.
    const offenders = sources
      .filter((source) => source.path.startsWith("features/spotify/"))
      .filter((source) =>
        /from\s+["'][^"']*\/ai(\/|["'])/.test(source.contents),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });

  it("gates provider fixtures on a test environment", () => {
    const environment = readFileSync(
      join(projectRoot, "lib", "validation", "environment.ts"),
      "utf8",
    );

    // Fixture data must be unreachable outside tests, or invented artists
    // could be served as though they came from a provider.
    expect(environment).toMatch(/PROVIDER_FIXTURES/);
    expect(environment).toMatch(
      /PROVIDER_FIXTURES === "1" &&\s*environment\.APP_ENV !== "test"/,
    );

    const fixtureModules = sources.filter((source) =>
      source.path.startsWith("lib/providers/fixtures/"),
    );

    expect(fixtureModules.length).toBeGreaterThan(0);

    // No product module may reach fixtures except the two provider factories.
    const importers = sources
      .filter((source) =>
        /from\s+["'][^"']*providers\/fixtures/.test(source.contents),
      )
      .map((source) => source.path)
      .filter((path) => !path.startsWith("lib/providers/fixtures/"));

    expect(importers.sort()).toEqual([
      "lib/providers/discovery/index.ts",
      "lib/providers/musicbrainz/index.ts",
    ]);
  });

  it("uses the current playlist-items path and never the deprecated one", () => {
    const offenders = sources
      .filter((source) =>
        /playlists\/\$\{[^}]+\}\/tracks/.test(source.contents),
      )
      .map((source) => source.path);

    expect(offenders).toEqual([]);
  });
});

describe("log redaction", () => {
  it("redacts every credential-bearing key a Spotify flow can produce", () => {
    const redacted = redactSensitive({
      event: "spotify.request",
      authorization: "Bearer secret-token",
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      code_verifier: "verifier-secret",
      ciphertext: "binary-secret",
      apiKey: "key-secret",
      operation: "current-user",
    }) as Record<string, unknown>;

    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.access_token).toBe("[REDACTED]");
    expect(redacted.refresh_token).toBe("[REDACTED]");
    expect(redacted.code_verifier).toBe("[REDACTED]");
    expect(redacted.ciphertext).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");

    // Non-sensitive operational context must survive, or the logs are useless.
    expect(redacted.operation).toBe("current-user");
  });

  it("redacts credentials nested inside an object", () => {
    const redacted = redactSensitive({
      request: { headers: { authorization: "Bearer secret" } },
    }) as { request: { headers: { authorization: string } } };

    expect(redacted.request.headers.authorization).toBe("[REDACTED]");
  });

  it("does not leave a serialized token anywhere in the output", () => {
    const serialized = JSON.stringify(
      redactSensitive({
        access_token: "BQC-super-secret-value",
        nested: [{ refresh_token: "AQD-another-secret" }],
      }),
    );

    expect(serialized).not.toContain("BQC-super-secret-value");
    expect(serialized).not.toContain("AQD-another-secret");
  });
});
