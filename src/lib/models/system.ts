import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, createdAt, date, int, json, pk, ref, text, updatedAt } from "./_base";

/** Singleton configuration row (`_id: "global"`), merged over DEFAULT_SETTINGS on read. */
export const Settings = sqliteTable("settings", {
  _id: text().primaryKey(),
  value: json<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
  updatedBy: ref(),
  updatedAt: updatedAt(),
});
export type ISettings = typeof Settings.$inferSelect;

/** Atomic sequence numbers for human-readable IDs (EMP-0001, MOV-000123, INV-2026-27-0001 …). */
export const Counter = sqliteTable("counters", {
  _id: text().primaryKey(),
  seq: int().notNull().default(0),
});
export type ICounter = typeof Counter.$inferSelect;

/** Expired sessions are purged by the admin job one day after expiry (MongoDB used a TTL index). */
export const Session = sqliteTable(
  "sessions",
  {
    _id: pk(),
    sid: text().notNull(),
    user: ref().notNull(),
    createdAt: createdAt(),
    lastSeenAt: date()
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: date().notNull(),
    ip: text(),
    userAgent: text(),
    method: text().$type<"google" | "password">().notNull(),
    revokedAt: date(),
    revokedReason: text(),
  },
  (t) => [uniqueIndex("sessions_sid").on(t.sid), index("sessions_user").on(t.user), index("sessions_expires_at").on(t.expiresAt)],
);
export type ISession = typeof Session.$inferSelect;

/** Failed sign-in attempts for rate limiting (purged after 1 hour by the admin job; reads ignore older rows). */
export const LoginAttempt = sqliteTable(
  "loginattempts",
  {
    _id: pk(),
    key: text().notNull(),
    at: date()
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("loginattempts_key").on(t.key), index("loginattempts_at").on(t.at)],
);
export type ILoginAttempt = typeof LoginAttempt.$inferSelect;

/** Lock + last-run bookkeeping for scheduled jobs (reminders, backups, retention). */
export const SystemJob = sqliteTable("systemjobs", {
  _id: text().primaryKey(),
  lastRunAt: date(),
  lockedUntil: date(),
  lastResult: text(),
});
export type ISystemJob = typeof SystemJob.$inferSelect;

export interface AuditChange {
  field: string;
  from?: string;
  to?: string;
}

export const AuditLog = sqliteTable(
  "auditlogs",
  {
    _id: pk(),
    actor: ref(),
    actorName: text().notNull(),
    actorRole: text(),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    ref: text(),
    summary: text().notNull(),
    changes: json<AuditChange[]>(),
    ip: text(),
    userAgent: text(),
    at: date()
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("auditlogs_actor").on(t.actor),
    index("auditlogs_action").on(t.action),
    index("auditlogs_entity").on(t.entity),
    index("auditlogs_entity_id").on(t.entityId),
    index("auditlogs_at").on(t.at),
  ],
);
export type IAuditLog = typeof AuditLog.$inferSelect;

export const StoredFile = sqliteTable(
  "storedfiles",
  {
    _id: pk(),
    key: text().notNull(),
    name: text().notNull(),
    size: int().notNull().default(0),
    mime: text().notNull().default("application/octet-stream"),
    /** Public files (avatars, company logo) live in the public bucket; everything else is streamed after a permission check. */
    isPublic: bool().notNull().default(false),
    url: text(),
    entityType: text().notNull(),
    entityId: text(),
    category: text(),
    confidential: bool().notNull().default(false),
    expiryDate: text(),
    notes: text(),
    version: int().notNull().default(1),
    replaces: ref(),
    replacedBy: ref(),
    uploadedBy: ref(),
    uploadedByName: text(),
    deletedAt: date(),
    deletedBy: ref(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("storedfiles_key").on(t.key),
    index("storedfiles_entity_type").on(t.entityType),
    index("storedfiles_entity_id").on(t.entityId),
  ],
);
export type IStoredFile = typeof StoredFile.$inferSelect;

export const Backup = sqliteTable("backups", {
  _id: pk(),
  key: text().notNull(),
  size: int().notNull().default(0),
  /** Per-table row counts (kept as `collections` for continuity with MongoDB-era backups). */
  collections: json<{ name: string; count: number }[]>()
    .notNull()
    .$defaultFn(() => []),
  trigger: text().$type<"manual" | "scheduled" | "pre_restore">().notNull().default("manual"),
  by: ref(),
  byName: text(),
  status: text().$type<"completed" | "failed">().notNull().default("completed"),
  error: text(),
  restoredAt: date(),
  restoredBy: text(),
  createdAt: createdAt(),
});
export type IBackup = typeof Backup.$inferSelect;
