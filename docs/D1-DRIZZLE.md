# Database: Cloudflare D1 + Drizzle

The ERP stores its data in **Cloudflare D1** (SQLite) through **Drizzle ORM**. This replaced MongoDB +
Mongoose; this page is the reference for writing queries and the cheat sheet used for the migration.

## Where things live

| What | Where |
|---|---|
| Tables (one file per domain) | `src/lib/models/*.ts` — exported under the old model names: `User`, `Task`, `Project`, … |
| Row types | `IUser = typeof User.$inferSelect`, `NewUser = typeof User.$inferInsert` (same `I…` names as before) |
| Embedded-data types | interfaces next to the table (`HistoryEntry`, `FileRef`, `TeamMember`, `Milestone`, …) |
| DB client | `db()` from `@/lib/db` — per-request Drizzle client for the `DB` binding |
| SQL helpers | `@/lib/sql` — `inList`, `jsonHas`, `jsonPush`, `searchAny`, `isUniqueViolation`, `insertChunked`, … |
| Migrations | `drizzle/*.sql`, generated with `npx drizzle-kit generate`, applied with `wrangler d1 migrations apply dx-erp --local/--remote` |

Table/column names equal the old MongoDB collection/field names (`users`, `employeeId`, …).

### Data mapping

- **Ids**: `_id` is a text primary key holding 24-hex strings (ObjectId format; migrated ids kept). The type is
  `Id` (= `string`). New rows get one automatically; for embedded entries call `newId()` (from `@/lib/models`).
- **Dates**: `Date` columns are epoch-ms integers that Drizzle maps to `Date`. Compare with `Date` objects.
  `"YYYY-MM-DD"` / `"YYYY-MM"` strings stay text columns — compare with strings.
- **Booleans**: integer 0/1 mapped to `boolean`; filter with `eq(T.flag, true)`.
- **Embedded documents / arrays / maps** (history, attachments, comments, team, milestones, line items, salary,
  internship, exit, …): JSON text columns typed with the same interfaces. Dates inside are revived to `Date` on read.
- **Optional fields are `null`, not `undefined`**, in rows read from the DB (`string | null`). Use `?? undefined`
  where a prop/param is `?: T`; use `null` (not `undefined`) to clear a column on update — `undefined` values in
  `.set({...})` are skipped.
- `updatedAt` is bumped automatically on every `db().update(...)`; `createdAt`/defaults are filled on insert.

## D1 limits that shape the code

- **100 bound parameters per statement** — never use Drizzle's `inArray()`; use `inList(col, values)` (one JSON
  parameter). Multi-row inserts go through `insertChunked(db(), T, rows)`.
- **50 queries per request on the Workers Free plan** — no queries inside loops over rows (N+1). Fetch related
  rows once with `inList(...)` and build a `Map`, or use a `leftJoin`. Independent queries can run in `Promise.all`.
- **No interactive transactions.** When several writes must be all-or-nothing use `db().batch([q1, q2, …])`
  (one atomic round trip). Single-statement atomic updates (`set({ seq: increment(T.seq) })`,
  `jsonPush`, conditional `where`) are preferred for counters and appends.

## Cheat sheet (Mongoose → Drizzle)

```ts
import { and, asc, count, desc, eq, gt, gte, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Task, newId, type Id } from "@/lib/models";
import { increment, inList, jsonHas, jsonHasField, jsonPath, jsonPush, notInList, searchAny } from "@/lib/sql";
```

| Mongoose | Drizzle |
|---|---|
| `await connectDB()` | delete the line |
| `Types.ObjectId`, `ObjectId` type | `Id` (string). `new Types.ObjectId(x)` → `x`; `a.equals(b)` → `a === b`; `.toString()` on ids is unnecessary |
| `T.find(f, { a: 1, b: 1 }).sort({ a: -1 }).skip(s).limit(n).lean()` | `db().select({ _id: T._id, a: T.a, b: T.b }).from(T).where(cond).orderBy(desc(T.a)).limit(n).offset(s)` |
| `T.find(f).lean()` (all fields) | `db().select().from(T).where(cond)` — prefer explicit columns on big tables (JSON history etc.) |
| `T.findById(id).lean()` / `findOne(f)` | `const [row] = await db().select().from(T).where(eq(T._id, id)).limit(1);` (`row` may be `undefined`) |
| `T.exists(f)` | `const [hit] = await db().select({ id: T._id }).from(T).where(cond).limit(1); Boolean(hit)` |
| `T.countDocuments(f)` / `estimatedDocumentCount()` | `await db().$count(T, cond)` |
| `T.distinct("f", filter)` | `(await db().selectDistinct({ f: T.f }).from(T).where(cond)).map((r) => r.f)` |
| `T.create(doc)` | `const [row] = await db().insert(T).values(doc).returning();` |
| `T.insertMany(docs)` | `await insertChunked(db(), T, docs)` (`{ ignoreConflicts: true }` for `ordered: false` + ignore duplicates) |
| `T.updateOne({ _id }, { $set: s })` | `await db().update(T).set(s).where(eq(T._id, id))` |
| guarded update, then check `modifiedCount` | `const done = await db().update(T).set(s).where(and(eq(T._id, id), eq(T.status, "pending"))).returning({ id: T._id }); if (!done.length) …` |
| `$unset: { f: 1 }` | `.set({ f: null })` |
| `$inc: { n: 1 }` | `.set({ n: increment(T.n, 1) })` |
| `$push: { history: entry }` / `$each` | `.set({ history: jsonPush(T.history, entry) })` / `jsonPush(T.history, a, b)` |
| `$pull`, `$addToSet`, positional `"arr.$.f"`, `arrayFilters`, `doc.arr.id(subId)` + `doc.save()` | read the row, change the array in JS, `update().set({ arr: next })` (keep guard conditions in `where`) |
| `findOneAndUpdate(f, u, { returnDocument: "after" })` | `const [row] = await db().update(T).set(s).where(cond).returning();` |
| upsert / `$setOnInsert` | `db().insert(T).values(v).onConflictDoUpdate({ target: [T.a, T.b], set: s })` / `.onConflictDoNothing()` |
| `deleteOne` / `deleteMany` | `db().delete(T).where(cond)` |
| `doc = await T.findById(); doc.x = y; await doc.save()` | `await db().update(T).set({ x: y }).where(eq(T._id, id))` |
| `err.code === 11000` | `isUniqueViolation(err)` |

### Filters

| Mongo filter | Drizzle condition |
|---|---|
| `{ a: v }` | `eq(T.a, v)` |
| `{ a: { $in: list } }` / `$nin` | `inList(T.a, list)` / `notInList(T.a, list)` |
| `{ a: null }` (null **or missing**) / `{ a: { $exists: true, $ne: null } }` | `isNull(T.a)` / `isNotNull(T.a)` |
| `{ a: { $ne: v } }` | `ne(T.a, v)` — Mongo's `$ne` also matched null/missing: on nullable columns use `or(isNull(T.a), ne(T.a, v))` |
| `$gt/$gte/$lt/$lte` | `gt/gte/lt/lte` |
| `$or: […]` / `$and: […]` | `or(…)` / `and(…)` — `undefined` entries are ignored; `and()` of nothing is `undefined` (= no filter) |
| array contains: `{ assignees: me }` | `jsonHas(T.assignees, me)` |
| array contains any: `{ assignees: { $in: ids } }` | `jsonHasAny(T.assignees, ids)` |
| array of objects: `{ "team.user": me }` | `jsonHasField(T.team, "user", me)` |
| `$elemMatch` with several conditions | ``sql`exists (select 1 from json_each(${T.arr}) where json_extract(value, '$.a') = ${x} and json_extract(value, '$.b') = ${y})` `` |
| nested object field: `{ "internship.mentor": me }` | `eq(jsonPath(T.internship, "mentor"), me)` |
| array size: `{ arr: { $size: 0 } }` | `eq(jsonLength(T.arr), 0)` |
| search box regex over fields | `searchAny(q, T.title, T.taskNo)` (escaped, case-insensitive `LIKE`) |
| `new RegExp("^" + escaped + "$", "i")` | `eqIgnoreCase(T.name, value)` |

Filter builders (e.g. `projectFilter`, `taskFilter`, `issueFilter`, `visibleResourceFilter`) return `SQL | undefined`
(`Filter` from `@/lib/work-access`); compose them with `and(visible, other)`.

### Aggregations

- Counts/sums per group:
  ```ts
  db().select({ status: T.status, n: count(), total: sql<number>`coalesce(sum(${T.amount}), 0)`.mapWith(Number) })
    .from(T).where(cond).groupBy(T.status)
  ```
  (Drizzle's `sum()` returns a **string** — use the `sql<number>` form above.)
- Month buckets of text dates: ``sql<string>`substr(${T.date}, 1, 7)` ``.
- `$unwind` over a JSON array: `json_each` in SQL, or select the rows and reduce in JS when the set is small.
- Complex pipelines over a bounded set (one person, one month, one project) are fine as select + JS reduce.

### Joins instead of lookups

```ts
db().select({ id: Task._id, title: Task.title, projectNo: Project.projectNo })
  .from(Task).leftJoin(Project, eq(Project._id, Task.project)).where(cond)
```

### Embedded entries need ids

Mongoose added `_id` to embedded entries automatically. Now set it when the interface has `_id`
(history, comments, attachments, milestones, team members, corrections, approvals, notes, …):
`jsonPush(T.history, { _id: newId(), ...historyEntry(user, "updated") })`.

### Write normalisation

Mongoose setters (`trim`, `lowercase`, `uppercase`) no longer run — the table comments say which fields need
them (emails lowercased + trimmed, role keys lowercased, codes uppercased, titles trimmed). zod schemas in the
actions remain the validation layer.
