import { sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, int, json, pk, ref, text, timestamps } from "./_base";

/** Writes must trim `name` and store `code` trimmed + uppercased. */
export const Department = sqliteTable(
  "departments",
  {
    _id: pk(),
    name: text().notNull(),
    code: text(),
    head: ref(),
    description: text(),
    active: bool().notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("departments_name").on(t.name)],
);
export type IDepartment = typeof Department.$inferSelect;

/** Writes must trim `name`. */
export const Designation = sqliteTable(
  "designations",
  {
    _id: pk(),
    name: text().notNull(),
    department: ref(),
    level: int(),
    active: bool().notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("designations_name").on(t.name)],
);
export type IDesignation = typeof Designation.$inferSelect;

/** Writes must store `key` trimmed + lowercased and trim `name`. */
export const Role = sqliteTable(
  "roles",
  {
    _id: pk(),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    permissions: json<string[]>().notNull().$defaultFn(() => []),
    system: bool().notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("roles_key").on(t.key)],
);
export type IRole = typeof Role.$inferSelect;

/** Writes must trim `name`. */
export const Holiday = sqliteTable(
  "holidays",
  {
    _id: pk(),
    date: text().notNull(),
    name: text().notNull(),
    optional: bool().notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("holidays_date").on(t.date)],
);
export type IHoliday = typeof Holiday.$inferSelect;
