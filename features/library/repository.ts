import "server-only";

import {
  decodeCursor,
  keysetFilter,
  nextCursorFor,
  SORT_COLUMNS,
  type SortMode,
} from "@/lib/library/cursor";
import {
  readStoredExplanation,
  type StoredExplanation,
} from "@/lib/library/explanation-snapshot";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/**
 * Library reads.
 *
 * Row Level Security is the authority on every query here; the explicit
 * `user_id` filters are belt and braces, and they also let the composite
 * indexes do their job.
 *
 * Two properties this module owes the interface. The page and the count must
 * agree — a count computed with different filters than the page is worse than
 * no count, because it is confidently wrong. And a page must never silently
 * drop a row, which is why the keyset carries an id tiebreaker.
 */

export const PAGE_SIZE = 24;

export type EntityFilter = "all" | "artist" | "mood" | "discography" | "manual";

export interface LibraryQuery {
  readonly userId: string;
  readonly sort: SortMode;
  readonly cursor: string | null;
  readonly search: string | null;
  readonly entity: EntityFilter;
  /** AND across tags: every selected tag must be present. */
  readonly tags: readonly string[];
}

export interface LibraryItem {
  readonly id: string;
  readonly artistName: string;
  readonly recordingName: string | null;
  readonly canonicalArtistId: string | null;
  readonly sourceType: string;
  readonly sourceReference: string | null;
  readonly note: string | null;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly explanation: StoredExplanation | null;
}

export interface LibraryPage {
  readonly items: readonly LibraryItem[];
  readonly nextCursor: string | null;
  /** Rows matching the current filters, which is not the page length. */
  readonly matching: number;
  /** Rows in the library regardless of filters, so an empty page can explain itself. */
  readonly total: number;
}

const SELECT_COLUMNS =
  "id, artist_name, recording_name, canonical_artist_id, source_type, source_reference, note, tags, created_at, explanation, explanation_version, explanation_source, explanation_provider, explanation_model";

/** Only the filter methods this module uses, so both query shapes satisfy it. */
interface Filterable<Self> {
  eq(column: string, value: unknown): Self;
  or(filter: string): Self;
  contains(column: string, value: readonly string[]): Self;
}

/**
 * Applies every filter except pagination.
 *
 * Shared by the page query and the count query on purpose: two filter chains
 * would drift, and a count that counts something other than what the page shows
 * is worse than no count at all.
 */
function applyFilters<T extends Filterable<T>>(
  query: T,
  input: LibraryQuery,
): T {
  let next = query.eq("user_id", input.userId);

  if (input.entity !== "all") {
    next = next.eq("source_type", input.entity);
  }

  if (input.tags.length > 0) {
    // `contains` is the array `@>` operator: every selected tag must be
    // present. OR would return nearly everything on a small library and read
    // as a broken filter.
    next = next.contains("tags", input.tags);
  }

  const search = input.search?.trim();

  if (search) {
    // PostgREST reads these as filter syntax, so a search containing one would
    // change the query rather than match a title.
    const escaped = search.replace(/[%,()\\]/g, "");

    if (escaped.length > 0) {
      next = next.or(
        `artist_name.ilike.%${escaped}%,recording_name.ilike.%${escaped}%,note.ilike.%${escaped}%`,
      );
    }
  }

  return next;
}

export async function readLibraryPage(
  input: LibraryQuery,
): Promise<LibraryPage> {
  const supabase = await createClient();
  const { column, ascending } = SORT_COLUMNS[input.sort];
  const cursor = decodeCursor(input.cursor);

  let query = applyFilters(
    supabase.from("favorite_discoveries").select(SELECT_COLUMNS),
    input,
  );

  if (cursor) {
    query = query.or(keysetFilter({ cursor, sort: input.sort }));
  }

  // One more than the page, so "is there another page" is answered by the data
  // rather than by a second count query that could disagree with it.
  const { data, error } = await query
    .order(column, { ascending })
    .order("id", { ascending })
    .limit(PAGE_SIZE + 1);

  if (error) {
    logger.warn({ event: "library.page_read_failed", code: error.code });
    return { items: [], nextCursor: null, matching: 0, total: 0 };
  }

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const visible = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const [matching, total] = await Promise.all([
    countMatching(input),
    countTotal(input.userId),
  ]);

  return {
    items: visible.map(toLibraryItem),
    nextCursor: nextCursorFor({
      rows: visible,
      sort: input.sort,
      hasMore,
    }),
    matching,
    total,
  };
}

async function countMatching(input: LibraryQuery): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await applyFilters(
    supabase
      .from("favorite_discoveries")
      .select("id", { count: "exact", head: true }),
    input,
  );

  if (error) return 0;

  return count ?? 0;
}

async function countTotal(userId: string): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("favorite_discoveries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return count ?? 0;
}

function toLibraryItem(row: {
  id: string;
  artist_name: string;
  recording_name: string | null;
  canonical_artist_id: string | null;
  source_type: string;
  source_reference: string | null;
  note: string | null;
  tags: string[] | null;
  created_at: string;
  explanation: unknown;
  explanation_version: number | null;
  explanation_source: string | null;
  explanation_provider: string | null;
  explanation_model: string | null;
}): LibraryItem {
  return {
    id: row.id,
    artistName: row.artist_name,
    recordingName: row.recording_name,
    canonicalArtistId: row.canonical_artist_id,
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    note: row.note,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    explanation: readStoredExplanation(row),
  };
}

/** Every tag this listener has used, for the filter's autocomplete. */
export async function readTagVocabulary(userId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("favorite_discoveries")
    .select("tags")
    .eq("user_id", userId);

  if (error || !data) return [];

  const seen = new Set<string>();

  for (const row of data) {
    for (const tag of row.tags ?? []) seen.add(tag);
  }

  return [...seen].sort();
}
