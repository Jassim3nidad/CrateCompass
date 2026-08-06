import type {
  Discography,
  ReleaseCategory,
  TimelineEntry,
} from "@/lib/discography/types";

/**
 * Choosing which releases a question is answered from.
 *
 * This is where the phase is won or lost. Filter too aggressively and the
 * release holding the answer never reaches the model, which produces a
 * confident "the records do not say" about something the records do say.
 * Filter too little and a prolific artist overruns the 200-release bound the
 * input schema enforces, and the cut falls wherever the array happened to end.
 *
 * The design consequence: **selection never removes a release for failing to
 * match the question.** Matching only ever *promotes*. Everything else is kept
 * behind it in chronological order, and the bound is what finally cuts. A
 * question that mentions no year and shares no word with any title still gets
 * the whole discography, oldest first, rather than an empty context.
 *
 * Two truths come out alongside the releases, and neither may be swallowed.
 * `retrievalComplete` says whether MusicBrainz's total matches what was
 * retrieved. `contextTruncated` says whether the bound cut this selection.
 * They are different failures: a discography can be complete but truncated for
 * one broad question, and a partial retrieval can still answer a narrow
 * question completely.
 */

/** The bound `answerDiscographyQuestionInputSchema` enforces. */
export const MAX_CONTEXT_RELEASES = 200;

export interface SelectionCriterion {
  readonly label: string;
  readonly detail: string;
}

export interface SelectedContext {
  readonly entries: readonly TimelineEntry[];
  /** True when the 200-release bound cut this selection. */
  readonly contextTruncated: boolean;
  /** Carried through from retrieval; false when the page bound engaged. */
  readonly retrievalComplete: boolean;
  /** How many releases exist in total, for an honest "N of M". */
  readonly totalAvailable: number;
  /** Stated in the interface, so a listener can see what was consulted. */
  readonly criteria: readonly SelectionCriterion[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "album",
  "albums",
  "any",
  "before",
  "by",
  "did",
  "do",
  "does",
  "ep",
  "eps",
  "first",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "last",
  "list",
  "many",
  "of",
  "on",
  "or",
  "record",
  "records",
  "release",
  "released",
  "releases",
  "single",
  "singles",
  "the",
  "their",
  "there",
  "they",
  "to",
  "was",
  "were",
  "what",
  "when",
  "which",
  "who",
  "with",
  "year",
  "years",
]);

function terms(question: string): readonly string[] {
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Four-digit years and decade forms ("2010s", "the 90s") named in a question. */
function yearsIn(question: string): readonly number[] {
  const found = new Set<number>();

  for (const match of question.matchAll(/\b(19|20)(\d{2})\b/g)) {
    found.add(Number.parseInt(`${match[1]}${match[2]}`, 10));
  }

  for (const match of question.matchAll(/\b(?:19|20)?(\d0)s\b/g)) {
    const raw = match[1] ?? "";
    const decade = Number.parseInt(raw, 10);
    // "90s" means 1990s; "10s" and "20s" mean the 2000s century.
    const start = decade >= 30 ? 1900 + decade : 2000 + decade;
    for (let year = start; year < start + 10; year += 1) found.add(year);
  }

  return [...found];
}

const CATEGORY_TERMS: ReadonlyMap<string, ReleaseCategory> = new Map([
  ["album", "album"],
  ["albums", "album"],
  ["studio", "album"],
  ["ep", "ep"],
  ["eps", "ep"],
  ["single", "single"],
  ["singles", "single"],
  ["live", "live"],
  ["compilation", "compilation"],
  ["compilations", "compilation"],
  ["soundtrack", "soundtrack"],
  ["soundtracks", "soundtrack"],
]);

function categoriesIn(question: string): ReadonlySet<ReleaseCategory> {
  const lowered = question.toLowerCase();
  const found = new Set<ReleaseCategory>();

  for (const [term, category] of CATEGORY_TERMS) {
    if (new RegExp(`\\b${term}\\b`).test(lowered)) found.add(category);
  }

  return found;
}

/**
 * A counting question needs the whole discography to answer honestly.
 *
 * Detected so the service can decline when retrieval was incomplete. A count
 * computed from a truncated list is wrong, not approximate.
 */
export function isCountingQuestion(question: string): boolean {
  return /\bhow\s+many\b|\bcount\b|\bnumber\s+of\b|\btotal\b/i.test(question);
}

function scoreOf(
  entry: TimelineEntry,
  questionTerms: readonly string[],
  questionYears: readonly number[],
  questionCategories: ReadonlySet<ReleaseCategory>,
): number {
  let score = 0;

  const title = entry.title.toLowerCase();
  for (const term of questionTerms) {
    if (title.includes(term)) score += 3;
  }

  const year = Number.parseInt(entry.firstReleaseDate.value ?? "", 10);
  if (Number.isFinite(year) && questionYears.includes(year)) score += 4;

  if (questionCategories.has(entry.category)) score += 2;

  return score;
}

/**
 * Selects the releases a question is answered from.
 *
 * Ordering is by score descending, then chronological, then title, so the cut
 * at the bound is deterministic rather than dependent on input order. The
 * returned entries are re-sorted chronologically: the model reads a timeline,
 * not a ranking, and a ranking would imply a relevance judgement the product
 * does not want it making.
 */
export function selectContext(input: {
  readonly discography: Discography;
  readonly question: string;
}): SelectedContext {
  const { discography, question } = input;

  const questionTerms = terms(question);
  const questionYears = yearsIn(question);
  const questionCategories = categoriesIn(question);

  const ranked = discography.entries
    .map((entry, index) => ({
      entry,
      index,
      score: scoreOf(entry, questionTerms, questionYears, questionCategories),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      // Chronological order is already the array order from retrieval.
      return left.index - right.index;
    });

  const kept = ranked.slice(0, MAX_CONTEXT_RELEASES);
  const contextTruncated = ranked.length > MAX_CONTEXT_RELEASES;

  const entries = kept
    .sort((left, right) => left.index - right.index)
    .map((item) => item.entry);

  const criteria: SelectionCriterion[] = [
    {
      label: "Ordering",
      detail: "Chronological, with releases matching your question promoted.",
    },
  ];

  if (questionYears.length > 0) {
    criteria.push({
      label: "Years",
      detail: `Releases dated ${Math.min(...questionYears)}-${Math.max(...questionYears)} were prioritised.`,
    });
  }

  if (questionCategories.size > 0) {
    criteria.push({
      label: "Types",
      detail: `${[...questionCategories].join(", ")} prioritised.`,
    });
  }

  if (contextTruncated) {
    criteria.push({
      label: "Bound",
      detail: `${MAX_CONTEXT_RELEASES} of ${discography.entries.length} releases were sent, the most relevant first.`,
    });
  }

  return {
    entries,
    contextTruncated,
    retrievalComplete: discography.retrievalComplete,
    totalAvailable: discography.total,
    criteria,
  };
}
