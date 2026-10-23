import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, desc, eq, getTableColumns, getTableName, isNull, lt, or } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { ActionError } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { Backup, BACKUP_TABLES, SystemJob, type IBackup } from "@/lib/models";
import { deleteObject, getObjectBuffer, putObject } from "@/lib/storage";

/**
 * Database backups (FRS §20.4, §23.4, acceptance item 21).
 *
 * A backup is one gzipped JSON document holding the raw D1 rows of every table in BACKUP_TABLES
 * (dates as epoch ms, booleans as 0/1, embedded data as JSON text — exactly as stored), kept in the
 * private R2 bucket under `<FILES_FOLDER>/backups/`. Snapshots are read in one D1 batch and a restore
 * is applied as one D1 batch, which D1 runs as a single transaction: it either fully applies or not at all.
 */
const FORMAT = "dx-erp-backup";
const FORMAT_VERSION = 2;
const RESTORE_LOCK = "backup-restore";
/** D1 binds at most 100 parameters per statement. */
const MAX_PARAMS = 100;

type BackupActor = Pick<CurrentUser, "_id" | "name" | "role">;
type RawRow = Record<string, unknown>;
type BackupData = Record<string, RawRow[]>;

function tables(): [string, SQLiteTable][] {
  return Object.entries(BACKUP_TABLES) as [string, SQLiteTable][];
}

function d1(): D1Database {
  return getCloudflareContext().env.DB;
}

function assertStorage(): void {
  if (!env.storage.configured) {
    throw new ActionError("File storage is not configured. Add the R2 bindings in wrangler.jsonc to use backups.");
  }
}

function backupKey(at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return [env.storage.folder, "backups", `${stamp}.json.gz`].filter(Boolean).join("/");
}

export function backupFileName(key: string): string {
  return `d4dx-backup-${key.split("/").pop() ?? "backup.json.gz"}`;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

async function snapshot(): Promise<{ bytes: Uint8Array; counts: { name: string; count: number }[] }> {
  const list = tables();
  const results = await d1().batch(list.map(([, table]) => d1().prepare(`SELECT * FROM "${getTableName(table)}"`)));
  const data: BackupData = {};
  const counts: { name: string; count: number }[] = [];
  list.forEach(([name], i) => {
    const rows = (results[i].results ?? []) as RawRow[];
    data[name] = rows;
    counts.push({ name, count: rows.length });
  });
  const payload = { format: FORMAT, version: FORMAT_VERSION, engine: "d1", createdAt: new Date(), tables: data };
  return { bytes: await gzip(JSON.stringify(payload)), counts };
}

/** Downloads a backup object and returns its tables. */
async function loadBackupData(key: string): Promise<BackupData> {
  let raw: Uint8Array;
  try {
    raw = await getObjectBuffer(key);
  } catch (error) {
    console.error("[backup] download failed", error);
    throw new ActionError("The backup file could not be downloaded from storage.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await gunzip(raw));
  } catch (error) {
    console.error("[backup] parse failed", error);
    throw new ActionError("The backup file is corrupt or unreadable.");
  }
  const body = payload as { format?: string; version?: number; tables?: unknown } | null;
  if (!body || body.format !== FORMAT) throw new ActionError("This file is not a D4DX ERP backup.");
  if (body.version !== FORMAT_VERSION || typeof body.tables !== "object" || body.tables === null) {
    throw new ActionError("This backup was made by the MongoDB version of the app and cannot be restored into D1.");
  }
  const out: BackupData = {};
  for (const [name, rows] of Object.entries(body.tables as Record<string, unknown>)) {
    if (!Array.isArray(rows)) throw new ActionError(`Table "${name}" in the backup is malformed.`);
    out[name] = rows as RawRow[];
  }
  return out;
}

/** Creates a backup now. Records a Backup row either way; rethrows on failure. */
export async function createBackup(trigger: IBackup["trigger"], actor?: BackupActor): Promise<IBackup> {
  assertStorage();
  const key = backupKey(new Date());
  try {
    const { bytes, counts } = await snapshot();
    await putObject(key, bytes, "application/gzip", false);
    const [doc] = await db()
      .insert(Backup)
      .values({ key, size: bytes.length, collections: counts, trigger, by: actor?._id, byName: actor?.name ?? "System", status: "completed" })
      .returning();
    const total = counts.reduce((n, c) => n + c.count, 0);
    await audit(actor ?? { name: "System" }, {
      action: "backup",
      entity: "backup",
      entityId: doc._id,
      ref: backupFileName(key),
      summary: `${trigger === "scheduled" ? "Automatic" : trigger === "pre_restore" ? "Safety (pre-restore)" : "Manual"} backup created · ${total} records in ${counts.length} tables`,
    });
    return doc;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[backup] failed", error);
    await db()
      .insert(Backup)
      .values({ key, size: 0, collections: [], trigger, by: actor?._id, byName: actor?.name ?? "System", status: "failed", error: message.slice(0, 500) })
      .catch((e: unknown) => console.error("[backup] could not record failure", e));
    await audit(actor ?? { name: "System" }, { action: "backup", entity: "backup", ref: backupFileName(key), summary: `Backup failed · ${message.slice(0, 200)}` });
    throw error instanceof ActionError ? error : new ActionError("The backup could not be completed. See the backup list for details.");
  }
}

export interface BackupVerification {
  ok: boolean;
  createdAt: Date;
  size: number;
  total: number;
  collections: { name: string; count: number; expected?: number; match: boolean }[];
  /** Tables the app knows about that are not in the file (restore leaves them untouched). */
  missing: string[];
  /** Tables in the file that this version of the app does not manage (ignored on restore). */
  unknown: string[];
  issues: string[];
}

function inspect(data: BackupData, recorded: IBackup["collections"]): Omit<BackupVerification, "createdAt" | "size"> {
  const expected = new Map(recorded.map((c) => [c.name, c.count]));
  const known = new Map(tables());
  const issues: string[] = [];
  const collections = Object.entries(data)
    .filter(([name]) => known.has(name))
    .map(([name, rows]) => {
      const exp = expected.get(name);
      const match = exp === undefined || exp === rows.length;
      if (!match) issues.push(`${name}: file holds ${rows.length} records but ${exp} were recorded`);
      const noId = rows.filter((r) => r._id === undefined || r._id === null).length;
      if (noId > 0) issues.push(`${name}: ${noId} records have no _id`);
      const columns = new Set(Object.values(getTableColumns(known.get(name)!)).map((c) => c.name));
      const foreign = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => !columns.has(c));
      if (foreign.length) issues.push(`${name}: unknown columns ${foreign.slice(0, 5).join(", ")}`);
      return { name, count: rows.length, expected: exp, match: match && noId === 0 && foreign.length === 0 };
    });
  return {
    ok: issues.length === 0 && collections.length > 0,
    total: collections.reduce((n, c) => n + c.count, 0),
    collections,
    missing: [...known.keys()].filter((name) => !(name in data)),
    unknown: Object.keys(data).filter((name) => !known.has(name)),
    issues: collections.length === 0 ? ["The backup contains no recognised tables."] : issues,
  };
}

async function findBackup(id: string): Promise<IBackup | undefined> {
  const [backup] = await db().select().from(Backup).where(eq(Backup._id, id)).limit(1);
  return backup;
}

/** Downloads and parses a backup without touching the database (the "test restore"). */
export async function verifyBackup(id: string): Promise<BackupVerification> {
  assertStorage();
  const backup = await findBackup(id);
  if (!backup) throw new ActionError("Backup not found.");
  if (backup.status !== "completed") throw new ActionError("This backup did not complete, so there is nothing to verify.");
  const data = await loadBackupData(backup.key);
  return { ...inspect(data, backup.collections), createdAt: backup.createdAt, size: backup.size };
}

export interface RestoreResult {
  safetyBackupId: string;
  collections: { name: string; expected: number; restored: number; error?: string }[];
  errors: string[];
}

async function withRestoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const now = new Date();
  const [locked] = await db()
    .insert(SystemJob)
    .values({ _id: RESTORE_LOCK, lockedUntil: new Date(now.getTime() + 30 * 60_000) })
    .onConflictDoUpdate({
      target: SystemJob._id,
      set: { lockedUntil: new Date(now.getTime() + 30 * 60_000) },
      setWhere: or(isNull(SystemJob.lockedUntil), lt(SystemJob.lockedUntil, now)),
    })
    .returning({ id: SystemJob._id });
  if (!locked) throw new ActionError("A restore is already running. Wait for it to finish.");
  try {
    return await fn();
  } finally {
    await db()
      .update(SystemJob)
      .set({ lockedUntil: null, lastRunAt: new Date() })
      .where(eq(SystemJob._id, RESTORE_LOCK))
      .catch(() => undefined);
  }
}

/** DELETE + chunked INSERTs (raw stored values) for one table. Column names are checked against the schema. */
function restoreStatements(table: SQLiteTable, rows: RawRow[]): D1PreparedStatement[] {
  const name = getTableName(table);
  const columns = Object.values(getTableColumns(table)).map((c) => c.name);
  const statements = [d1().prepare(`DELETE FROM "${name}"`)];
  const perRow = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const columnList = columns.map((c) => `"${c}"`).join(", ");
  const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += perRow) {
    const chunk = rows.slice(i, i + perRow);
    const values = chunk.flatMap((row) => columns.map((c) => (row[c] === undefined ? null : row[c])));
    statements.push(
      d1()
        .prepare(`INSERT INTO "${name}" (${columnList}) VALUES ${chunk.map(() => rowPlaceholders).join(", ")}`)
        .bind(...values),
    );
  }
  return statements;
}

/**
 * Replaces the business tables with the contents of a backup. A fresh safety backup is taken first.
 * Sessions, login attempts and job state are not touched. All tables are replaced in one D1 batch
 * (a single transaction). The caller must have confirmed the action with the user.
 */
export async function restoreBackup(id: string, actor: BackupActor): Promise<RestoreResult> {
  assertStorage();
  const backup = await findBackup(id);
  if (!backup) throw new ActionError("Backup not found.");
  if (backup.status !== "completed") throw new ActionError("This backup did not complete and cannot be restored.");

  return withRestoreLock(async () => {
    // Parse and check the file before touching anything.
    const data = await loadBackupData(backup.key);
    const check = inspect(data, backup.collections);
    if (!check.ok) throw new ActionError(`Backup failed verification, nothing was changed. ${check.issues.slice(0, 3).join("; ")}`);

    const safety = await createBackup("pre_restore", actor);

    const collections: RestoreResult["collections"] = [];
    const statements: D1PreparedStatement[] = [];
    for (const [name, table] of tables()) {
      const rows = data[name];
      if (!rows) continue; // not in this (older) backup: leave the live table alone
      if (name === "AuditLog") continue; // the audit trail is append-only: a restore must not erase newer entries
      statements.push(...restoreStatements(table, rows));
      collections.push({ name, expected: rows.length, restored: rows.length });
    }
    try {
      await d1().batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "Unknown error";
      console.error("[backup] restore failed", error);
      throw new ActionError(`The restore failed and nothing was changed (${message}).`);
    }

    await db().update(Backup).set({ restoredAt: new Date(), restoredBy: actor.name }).where(eq(Backup._id, backup._id));
    const total = collections.reduce((n, c) => n + c.restored, 0);
    await audit(actor, {
      action: "restore",
      entity: "backup",
      entityId: backup._id,
      ref: backupFileName(backup.key),
      summary: `Restored backup of ${backup.createdAt.toISOString()} · ${total} records in ${collections.length} tables · safety backup ${backupFileName(safety.key)}`,
    });
    return { safetyBackupId: safety._id, collections, errors: [] };
  });
}

/** Keeps the newest `keep` completed backups and deletes the rest (objects and records). */
export async function pruneBackups(keep: number): Promise<number> {
  const limit = Math.max(1, Math.floor(keep) || 1);
  const stale = await db().select().from(Backup).where(eq(Backup.status, "completed")).orderBy(desc(Backup.createdAt)).limit(-1).offset(limit);
  let removed = 0;
  for (const backup of stale) {
    try {
      if (env.storage.configured) await deleteObject(backup.key);
    } catch (error) {
      console.error("[backup] could not delete object", backup.key, error);
      continue; // keep the record so the next run retries
    }
    await db().delete(Backup).where(eq(Backup._id, backup._id));
    removed++;
  }
  await db()
    .delete(Backup)
    .where(and(eq(Backup.status, "failed"), lt(Backup.createdAt, new Date(Date.now() - 30 * 86_400_000))));
  return removed;
}
