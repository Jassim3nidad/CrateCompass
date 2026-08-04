/**
 * Runtime half of the Spotify-to-AI boundary.
 *
 * Phase 3 scope. This is the recursive rejector only — the full AI input
 * gateway (exact Zod schemas, provenance allowlists, per-adapter outbound
 * spies) is Phase 5 work. What exists here is enough to make the boundary
 * testable before any AI adapter exists, so the prohibition is enforced by
 * code from the moment Spotify data can be fetched rather than from the moment
 * an AI provider is added.
 *
 * The type-level half lives in `lib/providers/spotify/types.ts`, where Spotify
 * values are branded so they are not assignable to plain-string AI inputs.
 */

import { isAiApprovedProvenance } from "@/types/music";

export type AiBoundaryReason =
  | "forbidden-key"
  | "unapproved-provenance"
  | "spotify-uri"
  | "spotify-host"
  | "credential"
  | "too-large"
  | "too-deep"
  | "unsupported-value";

export class AiBoundaryViolationError extends Error {
  readonly reason: AiBoundaryReason;
  readonly path: string;

  constructor(reason: AiBoundaryReason, path: string) {
    // The offending value is never included: it is exactly the material that
    // must not travel, and error messages reach logs.
    super(
      `AI input rejected at ${path || "<root>"}: ${reason}. Spotify-derived data may never reach an AI provider.`,
    );
    this.name = "AiBoundaryViolationError";
    this.reason = reason;
    this.path = path;
  }
}

const FORBIDDEN_KEYS = new Set([
  "spotify",
  "spotifyid",
  "spotifyuri",
  "spotify_id",
  "spotify_uri",
  "spotifyaccountid",
  "spotify_account_id",
  "external_urls",
  "externalurls",
  "href",
  "images",
  "snapshot_id",
  "snapshotid",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "authorization",
  "code_verifier",
  "codeverifier",
]);

const SPOTIFY_HOST_PATTERN =
  /(^|[./@])(spotify\.com|scdn\.co|spotifycdn\.com)(\/|$|:)/i;
const SPOTIFY_URI_PATTERN = /\bspotify:[a-z]+:/i;
const CREDENTIAL_PATTERN =
  /\b(bearer\s+[\w-]|sbp_[a-z0-9]{20,}|eyJ[\w-]{10,}\.)/i;

const MAX_DEPTH = 12;
const MAX_SERIALIZED_LENGTH = 60_000;

function checkString(value: string, path: string): void {
  if (SPOTIFY_URI_PATTERN.test(value)) {
    throw new AiBoundaryViolationError("spotify-uri", path);
  }

  if (SPOTIFY_HOST_PATTERN.test(value)) {
    throw new AiBoundaryViolationError("spotify-host", path);
  }

  if (CREDENTIAL_PATTERN.test(value)) {
    throw new AiBoundaryViolationError("credential", path);
  }
}

function walk(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new AiBoundaryViolationError("too-deep", path);
  }

  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    checkString(value, path);
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new AiBoundaryViolationError(
          "forbidden-key",
          path ? `${path}.${key}` : key,
        );
      }

      const childPath = path ? `${path}.${key}` : key;

      // Positive control alongside the negative checks: every externally
      // sourced fact declares where it came from, and only sources whose terms
      // permit the processing may travel. Spotify is never on that list, so
      // this catches Spotify-derived data even when it carries no telltale
      // key, URI or host.
      if (
        key === "provenance" &&
        typeof nested === "string" &&
        !isAiApprovedProvenance(nested)
      ) {
        throw new AiBoundaryViolationError("unapproved-provenance", childPath);
      }

      // Key names are attacker-influenced too when they come from provider
      // payloads, so they are string-checked alongside values.
      checkString(key, childPath);
      walk(nested, childPath, depth + 1);
    }

    return;
  }

  // Functions, symbols, bigints, class instances with prototypes we cannot
  // reason about: refused rather than serialized blindly.
  throw new AiBoundaryViolationError("unsupported-value", path);
}

/**
 * Returns the value unchanged when it is safe to send to an AI provider, and
 * throws otherwise. Callers must send the returned value, not their original
 * reference.
 */
export function assertAiSafe<T>(value: T): T {
  let serialized: string;

  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    throw new AiBoundaryViolationError("unsupported-value", "");
  }

  if (serialized.length > MAX_SERIALIZED_LENGTH) {
    throw new AiBoundaryViolationError("too-large", "");
  }

  walk(value, "", 0);

  return value;
}

export function isAiSafe(value: unknown): boolean {
  try {
    assertAiSafe(value);
    return true;
  } catch {
    return false;
  }
}
