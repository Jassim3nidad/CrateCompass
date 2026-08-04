import type { z } from "zod";

import { isAiApprovedProvenance } from "@/types/music";

/**
 * The single gateway every AI request passes through.
 *
 * Defence in depth, in the order the checks run:
 *
 * 1. **Exact-schema parse.** The caller's object is parsed against a strict
 *    schema that rejects unknown keys. This is the primary control: a field
 *    that is not in the schema cannot travel, whatever it contains.
 * 2. **Provenance allowlist.** Any `provenance` value must name a source whose
 *    terms permit AI processing. Spotify never appears on that list, so
 *    Spotify-derived data is caught even when it carries no telltale string.
 * 3. **Recursive content scan.** Forbidden keys, Spotify URIs, Spotify-
 *    controlled hosts, and credential-shaped strings, at any depth.
 * 4. **Size and depth caps.**
 *
 * The parsed result is returned and is what callers must send. Returning the
 * parse output rather than the input is deliberate: it guarantees the payload
 * on the wire is the validated clone, not the caller's original object with
 * whatever extra properties were hanging off it.
 *
 * This supersedes the Phase 3 interim guard, which had no schema or provenance
 * layer — only checks 3 and 4.
 */

export type AiBoundaryReason =
  | "schema-rejected"
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

  constructor(reason: AiBoundaryReason, path: string, detail?: string) {
    // The offending value is never included: it is exactly the material that
    // must not travel, and error messages reach logs.
    super(
      `AI input rejected at ${path || "<root>"}: ${reason}${detail ? ` (${detail})` : ""}. Spotify-derived data may never reach an AI provider.`,
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
      const childPath = path ? `${path}.${key}` : key;

      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new AiBoundaryViolationError("forbidden-key", childPath);
      }

      // Positive control on the domain types' provenance field only.
      //
      // Deliberately *not* extended to a key named `source`: that word is too
      // generic — it legitimately holds URLs and free-text labels elsewhere —
      // and treating it as a provenance enum rejects valid input. The AI port's
      // `EvidenceFact.source` is constrained by a strict Zod enum instead
      // (`evidenceFactSchema`), which is a stronger control than string
      // matching because it makes an unapproved value unrepresentable.
      if (
        key === "provenance" &&
        typeof nested === "string" &&
        !isAiApprovedProvenance(nested)
      ) {
        throw new AiBoundaryViolationError("unapproved-provenance", childPath);
      }

      checkString(key, childPath);
      walk(nested, childPath, depth + 1);
    }

    return;
  }

  throw new AiBoundaryViolationError("unsupported-value", path);
}

/** The recursive content scan, exposed for property tests. */
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

/**
 * The only supported way to construct an AI request payload.
 *
 * Returns the parsed value. Callers must send what this returns — sending the
 * original object instead would bypass the schema strip that makes check 1
 * meaningful.
 */
export function buildAiInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AiBoundaryViolationError(
      "schema-rejected",
      issue?.path.join(".") ?? "",
      issue?.code,
    );
  }

  return assertAiSafe(parsed.data) as z.infer<Schema>;
}
