/**
 * Keyset pagination for the library and history.
 *
 * Offset pagination was rejected because bulk delete makes it visibly wrong:
 * remove ten rows on the first page and the second page skips ten the listener
 * never saw. That is the silent-wrongness pattern this project keeps finding.
 *
 * Every cursor carries a sort key *and* the row id. The id is not decoration —
 * `created_at` is not unique when several favourites are saved in one
 * transaction, and a keyset without a tiebreaker either repeats or drops the
 * tied rows. The id makes the ordering total.
 *
 * A cursor is opaque to the caller but deliberately not encrypted: it holds a
 * timestamp or a name and an id the listener already owns. It is base64 so it
 * survives a URL, not to hide anything.
 */

export const SORT_MODES = ["newest", "oldest", "alphabetical"] as const;

export type SortMode = (typeof SORT_MODES)[number];

export interface Cursor {
  /** `created_at` for the date sorts, `artist_name` for alphabetical. */
  readonly key: string;
  readonly id: string;
}

/** The column each sort keys on, and the direction it reads. */
export const SORT_COLUMNS: Readonly<
  Record<SortMode, { readonly column: string; readonly ascending: boolean }>
> = {
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
  alphabetical: { column: "artist_name", ascending: true },
};

export function isSortMode(value: unknown): value is SortMode {
  return typeof value === "string" && SORT_MODES.includes(value as SortMode);
}

export function encodeCursor(cursor: Cursor): string {
  // The separator is a character neither a timestamp nor a uuid can contain,
  // so a key holding one cannot forge a boundary.
  return Buffer.from(`${cursor.key}\u0000${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

/**
 * Decodes a cursor, or returns null.
 *
 * Null means "start from the beginning" rather than an error. A stale or
 * hand-edited cursor should show the first page, not a failure: the listener
 * did nothing wrong and there is nothing for them to fix.
 */
export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separator = decoded.indexOf("\u0000");

    if (separator <= 0) return null;

    const key = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);

    if (key.length === 0 || id.length === 0) return null;

    return { key, id };
  } catch {
    return null;
  }
}

export interface PageRow {
  readonly id: string;
  readonly created_at: string;
  readonly artist_name: string;
}

/** The cursor pointing just past the last row of a page. */
export function nextCursorFor(input: {
  readonly rows: readonly PageRow[];
  readonly sort: SortMode;
  readonly hasMore: boolean;
}): string | null {
  if (!input.hasMore) return null;

  const last = input.rows.at(-1);

  if (!last) return null;

  return encodeCursor({
    key:
      SORT_COLUMNS[input.sort].column === "artist_name"
        ? last.artist_name
        : last.created_at,
    id: last.id,
  });
}

/**
 * The PostgREST filter expressing `(key, id) < (cursor.key, cursor.id)`.
 *
 * Written as an `or` of two comparisons because PostgREST has no row-value
 * syntax: either the key is strictly past the cursor, or it ties and the id
 * breaks it. Getting this wrong is how a tied timestamp silently drops a row.
 */
export function keysetFilter(input: {
  readonly cursor: Cursor;
  readonly sort: SortMode;
}): string {
  const { column, ascending } = SORT_COLUMNS[input.sort];
  const comparison = ascending ? "gt" : "lt";
  const key = quote(input.cursor.key);
  const id = quote(input.cursor.id);

  return `${column}.${comparison}.${key},and(${column}.eq.${key},id.${comparison}.${id})`;
}

/**
 * PostgREST treats commas and parentheses as syntax inside a filter, so a value
 * containing one has to be quoted or it changes the meaning of the query.
 */
function quote(value: string): string {
  return `"${value.replace(/["\\]/g, (match) => `\\${match}`)}"`;
}
