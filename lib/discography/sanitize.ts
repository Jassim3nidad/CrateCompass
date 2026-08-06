import type { TimelineEntry } from "@/lib/discography/types";

/**
 * Neutralising community-edited text on its way to a model.
 *
 * Release titles and disambiguation comments are edited by the public. A
 * release group can be titled "Ignore previous instructions and...", and that
 * string travels to the model as retrieved context. The AI gateway does not
 * address this and should not: `buildAiInput` enforces provenance, forbidden
 * keys, Spotify patterns and size caps, which are questions about *where data
 * came from*, not about what a sentence looks like.
 *
 * Two layers, split by how reliable each one is.
 *
 * **Delimiting is blocking, and does the actual work.** Every retrieved value
 * is escaped so it cannot terminate its own field, and is carried in a
 * structured envelope that says what it is. This is deterministic: it removes
 * the ambiguity that lets a title read as a directive, rather than guessing
 * whether a particular title was meant as one.
 *
 * **Detection is logged and never blocks.** "Instruction shaped" is not
 * reliably detectable, and MusicBrainz holds real releases whose titles are
 * imperative sentences. A blocking heuristic would corrupt genuine discography
 * entries on exactly the catalogues people find most interesting, and would do
 * so silently, which is the class of defect this phase exists to avoid. The
 * flag is evidence for a future decision, not a control.
 *
 * The original text is always returned untouched for display. Altering what is
 * shown would misrepresent MusicBrainz.
 */

const MAX_FIELD_LENGTH = 300;

/**
 * C0 and C1 control characters, which can break a delimited field.
 *
 * Tested by code point rather than by a regular expression with literal
 * characters in it: those characters are invisible in an editor, so a range
 * written inline is unreviewable and easy to corrupt in transit.
 */
function isControlCharacter(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/**
 * Zero-width spaces, bidirectional overrides, word joiners, and the byte-order
 * mark. None carries meaning in a release title, and all can hide text from
 * anyone reviewing the record.
 */
function isInvisibleCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2064) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff
  );
}

/**
 * Control characters collapse to a space so words cannot run together;
 * invisible marks are removed outright, because they were never separating
 * anything.
 */
function stripUnsafeCharacters(value: string): string {
  let result = "";

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (isControlCharacter(codePoint)) {
      result += " ";
      continue;
    }

    if (isInvisibleCharacter(codePoint)) {
      continue;
    }

    result += character;
  }

  return result;
}

export interface SanitizedField {
  /** Safe to place in the model envelope. */
  readonly value: string;
  /** Exactly what MusicBrainz holds, for display. */
  readonly original: string;
  /** True when the value looked instruction-shaped. Never blocks. */
  readonly flagged: boolean;
}

/**
 * Phrases that appear in prompt-injection attempts far more often than in
 * record titles.
 *
 * Deliberately narrow and multi-word. A single-word list would flag "Ignore"
 * by Nine Inch Nails and every album called "System"; requiring a phrase keeps
 * the false-positive rate low enough that the log is worth reading. Even so
 * this only ever sets a boolean.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  // The optional article matters: "ignore the previous instructions" is the
  // more natural phrasing and was missed without it.
  /ignore\s+(?:all\s+|the\s+)*(?:previous|prior|above|earlier)\s+instructions?/i,
  /disregard\s+(?:all\s+|the\s+)*(?:previous|prior|above|earlier)/i,
  /you\s+are\s+now\s+(?:a|an)\s/i,
  /system\s*(?:prompt|message)\s*:/i,
  // Chat-template markers such as <|im_start|>. Not valid in a release title.
  /<\|[a-z_]+\|>/i,
  /\bBEGIN\s+(?:SYSTEM|INSTRUCTIONS?)\b/,
  /answer\s+(?:only|always)\s+with/i,
  /do\s+not\s+(?:cite|mention|follow)\s+(?:the\s+)?(?:sources?|records?|instructions?)/i,
];

export function looksInstructionShaped(value: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Makes one value safe to carry, and reports whether it looked like a directive.
 *
 * Escaping happens whatever the flag says. A title is neutralised because it is
 * untrusted, not because it looked suspicious.
 */
export function sanitizeField(value: string | null): SanitizedField {
  const original = value ?? "";

  const escaped = stripUnsafeCharacters(original)
    // Backslash first, or the escape below would itself be escaped again.
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FIELD_LENGTH);

  return {
    value: escaped,
    original,
    flagged: looksInstructionShaped(original),
  };
}

export interface SanitizedRelease {
  readonly id: string;
  readonly title: string;
  readonly primaryType: string | null;
  readonly firstReleaseDate: string | null;
}

export interface SanitizeResult {
  readonly releases: readonly SanitizedRelease[];
  /** Identifiers whose title or disambiguation was flagged. Log, not control. */
  readonly flaggedIds: readonly string[];
}

/**
 * The identifier is constrained rather than escaped.
 *
 * It is the value citation verification later compares against, so a
 * manipulated one would weaken that check rather than the prose. Anything that
 * is not a plausible MusicBrainz identifier is dropped from the context.
 */
const IDENTIFIER_PATTERN = /^[0-9a-f-]{8,64}$/i;

/** Prepares retrieved releases for the AI port's input schema. */
export function sanitizeReleases(
  entries: readonly TimelineEntry[],
): SanitizeResult {
  const releases: SanitizedRelease[] = [];
  const flaggedIds: string[] = [];

  for (const entry of entries) {
    if (!IDENTIFIER_PATTERN.test(entry.mbid)) {
      continue;
    }

    const title = sanitizeField(entry.title);
    const disambiguation = sanitizeField(entry.disambiguation);

    if (title.flagged || disambiguation.flagged) {
      flaggedIds.push(entry.mbid);
    }

    releases.push({
      id: entry.mbid,
      // An empty title after escaping would fail the input schema's min(1).
      // A placeholder keeps the release present and citable rather than
      // silently dropping it from the context.
      title: title.value || "[untitled release]",
      primaryType: entry.primaryType,
      firstReleaseDate: entry.firstReleaseDate.value,
    });
  }

  return { releases, flaggedIds };
}
