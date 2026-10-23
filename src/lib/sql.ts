import { getTableColumns, or, sql, type Column, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database } from "@/lib/db";

/**
 * SQL helpers for D1 (SQLite). D1 binds at most 100 parameters per statement, so list filters pass
 * their values as ONE JSON parameter and expand it with `json_each` instead of `IN (?, ?, …)`.
 */

type Operand = Column | SQL;
type Scalar = string | number | boolean;

/** `col IN (values)` — safe for any number of values. An empty list matches nothing. */
export function inList(col: Operand, values: readonly Scalar[]): SQL {
  if (!values.length) return sql`0`;
  return sql`${col} in (select value from json_each(${JSON.stringify(values)}))`;
}

/** `col NOT IN (values)` — an empty list matches everything (including NULL columns). */
export function notInList(col: Operand, values: readonly Scalar[]): SQL {
  if (!values.length) return sql`1`;
  return sql`(${col} is null or ${col} not in (select value from json_each(${JSON.stringify(values)})))`;
}

/** JSON array column (e.g. `Task.assignees`) contains `value`. */
export function jsonHas(col: Column, value: Scalar): SQL {
  return sql`exists (select 1 from json_each(${col}) where value = ${value})`;
}

/** JSON array column contains at least one of `values`. */
export function jsonHasAny(col: Column, values: readonly Scalar[]): SQL {
  if (!values.length) return sql`0`;
  return sql`exists (select 1 from json_each(${col}) where value in (select value from json_each(${JSON.stringify(values)})))`;
}

/** JSON array of objects has an element whose `field` equals `value` (e.g. `Project.team[].user`). */
export function jsonHasField(col: Column, field: string, value: Scalar): SQL {
  return sql`exists (select 1 from json_each(${col}) where json_extract(value, ${`$.${field}`}) = ${value})`;
}

/** Value at `path` inside a JSON object column (e.g. `jsonPath(User.internship, "mentor")`). */
export function jsonPath<T = unknown>(col: Column, path: string): SQL<T> {
  return sql<T>`json_extract(${col}, ${`$.${path}`})`;
}

/** Number of elements in a JSON array column. */
export function jsonLength(col: Column): SQL<number> {
  return sql<number>`json_array_length(${col})`;
}

/**
 * Atomic append to a JSON array column — the `$push` equivalent, for `update().set({ col: jsonPush(col, item) })`.
 * Items are serialised like the `json()` column type (Dates → ISO strings).
 */
export function jsonPush(col: Column, ...items: unknown[]): SQL {
  let expr: SQL = sql`coalesce(${col}, '[]')`;
  for (const item of items) expr = sql`json_insert(${expr}, '$[#]', json(${JSON.stringify(item)}))`;
  return expr;
}

/** Atomic numeric increment — the `$inc` equivalent. */
export function increment(col: Column, by = 1): SQL {
  return sql`coalesce(${col}, 0) + ${by}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Case-insensitive "contains" for search boxes (escaped, length-capped). `undefined` when `q` is blank. */
export function containsText(col: Operand, q: string): SQL | undefined {
  const t = q.trim().slice(0, 100);
  if (!t) return undefined;
  return sql`${col} like ${`%${escapeLike(t)}%`} escape '\\'`;
}

/** Search box over several columns: any column contains `q`. `undefined` when `q` is blank. */
export function searchAny(q: string, ...cols: Operand[]): SQL | undefined {
  if (!q.trim()) return undefined;
  return or(...cols.map((c) => containsText(c, q)));
}

/** Case-insensitive "starts with". */
export function startsWithText(col: Operand, q: string): SQL {
  return sql`${col} like ${`${escapeLike(q)}%`} escape '\\'`;
}

/** Case-insensitive equality (the old `^value$` / "i" regex). */
export function eqIgnoreCase(col: Operand, value: string): SQL {
  return sql`lower(${col}) = lower(${value})`;
}

/** True when an insert/update failed on a UNIQUE index (MongoDB's E11000). */
export function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && depth < 5; depth++) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Inserts rows in chunks small enough for D1's 100-bound-parameter limit. `ignoreConflicts` skips rows
 * that hit a UNIQUE index (MongoDB `insertMany(…, { ordered: false })` + ignoring E11000).
 */
export async function insertChunked<T extends SQLiteTable>(
  database: Database,
  table: T,
  rows: T["$inferInsert"][],
  opts: { ignoreConflicts?: boolean } = {},
): Promise<void> {
  if (!rows.length) return;
  const perRow = Object.keys(getTableColumns(table)).length;
  const size = Math.max(1, Math.floor(100 / perRow));
  for (let i = 0; i < rows.length; i += size) {
    const insert = database.insert(table).values(rows.slice(i, i + size));
    await (opts.ignoreConflicts ? insert.onConflictDoNothing() : insert);
  }
}
