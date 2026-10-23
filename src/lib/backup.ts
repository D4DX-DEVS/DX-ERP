import "server-only";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { ActionError } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { Backup, BACKUP_MODELS, SystemJob, type IBackup } from "@/lib/models";
import { deleteObject, getObjectBuffer, putObject } from "@/lib/storage";

/**
 * Database backups (FRS §20.4, §23.4, acceptance item 21).
 *
 * A backup is one gzipped Extended-JSON document holding every collection in BACKUP_MODELS,
 * stored privately in Spaces under `<DO_SPACES_FOLDER>/backups/`. Extended JSON in canonical
 * mode keeps ObjectIds, Dates and numeric types intact, so a restore reproduces the data exactly.
 */
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const FORMAT = "dx-erp-backup";
const FORMAT_VERSION = 1;
const RESTORE_BATCH = 500;
const RESTORE_LOCK = "backup-restore";

type BackupActor = Pick<CurrentUser, "_id" | "name" | "role">;
type RawDoc = Record<string, unknown>;
type BackupData = Record<string, RawDoc[]>;

const EJSON = mongoose.mongo.BSON.EJSON;

function models(): [string, mongoose.Model<RawDoc>][] {
  return Object.entries(BACKUP_MODELS).map(([name, model]) => [name, model as unknown as mongoose.Model<RawDoc>]);
}

function assertStorage(): void {
  if (!env.spaces.configured) {
    throw new ActionError("File storage is not configured. Set the DO_SPACES_* environment variables to use backups.");
  }
}

function backupKey(at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return [env.spaces.folder, "backups", `${stamp}.json.gz`].filter(Boolean).join("/");
}

export function backupFileName(key: string): string {
  return `d4dx-backup-${key.split("/").pop() ?? "backup.json.gz"}`;
}

async function snapshot(): Promise<{ buffer: Buffer; counts: { name: string; count: number }[] }> {
  const data: BackupData = {};
  const counts: { name: string; count: number }[] = [];
  for (const [name, model] of models()) {
    const docs = (await model.find({}).lean()) as RawDoc[];
    data[name] = docs;
    counts.push({ name, count: docs.length });
  }
  const payload = { format: FORMAT, version: FORMAT_VERSION, createdAt: new Date(), collections: data };
  const json = EJSON.stringify(payload, { relaxed: false });
  const buffer = await gzipAsync(Buffer.from(json, "utf8"));
  return { buffer, counts };
}

/** Downloads a backup object and returns its collections with all BSON types restored. */
async function loadBackupData(key: string): Promise<BackupData> {
  let raw: Buffer;
  try {
    raw = await getObjectBuffer(key);
  } catch (error) {
    console.error("[backup] download failed", error);
    throw new ActionError("The backup file could not be downloaded from storage.");
  }
  let payload: unknown;
  try {
    const text = (await gunzipAsync(raw)).toString("utf8");
    payload = EJSON.parse(text, { relaxed: false });
  } catch (error) {
    console.error("[backup] parse failed", error);
    throw new ActionError("The backup file is corrupt or unreadable.");
  }
  const body = payload as { format?: string; collections?: unknown } | null;
  if (!body || body.format !== FORMAT || typeof body.collections !== "object" || body.collections === null) {
    throw new ActionError("This file is not a D4DX ERP backup.");
  }
  const out: BackupData = {};
  for (const [name, docs] of Object.entries(body.collections as Record<string, unknown>)) {
    if (!Array.isArray(docs)) throw new ActionError(`Collection "${name}" in the backup is malformed.`);
    out[name] = docs as RawDoc[];
  }
  return out;
}

/** Creates a backup now. Records a Backup document either way; rethrows on failure. */
export async function createBackup(trigger: IBackup["trigger"], actor?: BackupActor): Promise<IBackup> {
  assertStorage();
  await connectDB();
  const key = backupKey(new Date());
  try {
    const { buffer, counts } = await snapshot();
    await putObject(key, buffer, "application/gzip", false);
    const doc = await Backup.create({
      key,
      size: buffer.length,
      collections: counts,
      trigger,
      by: actor?._id,
      byName: actor?.name ?? "System",
      status: "completed",
    });
    const total = counts.reduce((n, c) => n + c.count, 0);
    await audit(actor ?? { name: "System" }, {
      action: "backup",
      entity: "backup",
      entityId: doc._id,
      ref: backupFileName(key),
      summary: `${trigger === "scheduled" ? "Automatic" : trigger === "pre_restore" ? "Safety (pre-restore)" : "Manual"} backup created · ${total} records in ${counts.length} collections`,
    });
    return doc.toObject();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[backup] failed", error);
    await Backup.create({
      key,
      size: 0,
      collections: [],
      trigger,
      by: actor?._id,
      byName: actor?.name ?? "System",
      status: "failed",
      error: message.slice(0, 500),
    }).catch((e: unknown) => console.error("[backup] could not record failure", e));
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
  /** Collections the app knows about that are not in the file (restore leaves them untouched). */
  missing: string[];
  /** Collections in the file that this version of the app does not manage (ignored on restore). */
  unknown: string[];
  issues: string[];
}

function inspect(data: BackupData, recorded: IBackup["collections"]): Omit<BackupVerification, "createdAt" | "size"> {
  const expected = new Map(recorded.map((c) => [c.name, c.count]));
  const known = new Set(models().map(([name]) => name));
  const issues: string[] = [];
  const collections = Object.entries(data)
    .filter(([name]) => known.has(name))
    .map(([name, docs]) => {
      const exp = expected.get(name);
      const match = exp === undefined || exp === docs.length;
      if (!match) issues.push(`${name}: file holds ${docs.length} records but ${exp} were recorded`);
      const noId = docs.filter((d) => d._id === undefined || d._id === null).length;
      if (noId > 0) issues.push(`${name}: ${noId} records have no _id`);
      return { name, count: docs.length, expected: exp, match: match && noId === 0 };
    });
  return {
    ok: issues.length === 0 && collections.length > 0,
    total: collections.reduce((n, c) => n + c.count, 0),
    collections,
    missing: [...known].filter((name) => !(name in data)),
    unknown: Object.keys(data).filter((name) => !known.has(name)),
    issues: collections.length === 0 ? ["The backup contains no recognised collections."] : issues,
  };
}

/** Downloads and parses a backup without touching the database (the "test restore"). */
export async function verifyBackup(id: string): Promise<BackupVerification> {
  assertStorage();
  await connectDB();
  const backup = await Backup.findById(id).lean();
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
  try {
    await SystemJob.findOneAndUpdate(
      { _id: RESTORE_LOCK, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + 30 * 60_000) } },
      { upsert: true, returnDocument: "after" },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ActionError("A restore is already running. Wait for it to finish.");
    throw error;
  }
  try {
    return await fn();
  } finally {
    await SystemJob.updateOne({ _id: RESTORE_LOCK }, { $set: { lockedUntil: null, lastRunAt: new Date() } }).catch(() => undefined);
  }
}

async function restoreCollection(model: mongoose.Model<RawDoc>, docs: RawDoc[]): Promise<{ restored: number; error?: string }> {
  const col = model.collection as unknown as mongoose.mongo.Collection<mongoose.mongo.Document>;
  await col.deleteMany({});
  let restored = 0;
  let error: string | undefined;
  for (let i = 0; i < docs.length; i += RESTORE_BATCH) {
    const batch = docs.slice(i, i + RESTORE_BATCH) as mongoose.mongo.Document[];
    try {
      const res = await col.insertMany(batch, { ordered: false });
      restored += res.insertedCount;
    } catch (e) {
      if (e instanceof mongoose.mongo.MongoBulkWriteError) {
        restored += e.insertedCount;
        error = `${batch.length - e.insertedCount} records in a batch were rejected (${e.message.slice(0, 160)})`;
      } else {
        error = e instanceof Error ? e.message.slice(0, 200) : "Unknown error";
      }
    }
  }
  return { restored, error };
}

/**
 * Replaces the business collections with the contents of a backup. A fresh safety backup is taken
 * first. Sessions, login attempts and job state are not touched. The caller must have confirmed
 * the action with the user.
 */
export async function restoreBackup(id: string, actor: BackupActor): Promise<RestoreResult> {
  assertStorage();
  await connectDB();
  const backup = await Backup.findById(id).lean();
  if (!backup) throw new ActionError("Backup not found.");
  if (backup.status !== "completed") throw new ActionError("This backup did not complete and cannot be restored.");

  return withRestoreLock(async () => {
    // Parse and check the file before touching anything.
    const data = await loadBackupData(backup.key);
    const check = inspect(data, backup.collections);
    if (!check.ok) throw new ActionError(`Backup failed verification, nothing was changed. ${check.issues.slice(0, 3).join("; ")}`);

    const safety = await createBackup("pre_restore", actor);

    const collections: RestoreResult["collections"] = [];
    const errors: string[] = [];
    for (const [name, model] of models()) {
      const docs = data[name];
      if (!docs) continue; // not in this (older) backup: leave the live collection alone
      if (name === "AuditLog") continue; // the audit trail is append-only: a restore must not erase newer entries
      try {
        const res = await restoreCollection(model, docs);
        collections.push({ name, expected: docs.length, restored: res.restored, error: res.error });
        if (res.error) errors.push(`${name}: ${res.error}`);
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 200) : "Unknown error";
        collections.push({ name, expected: docs.length, restored: 0, error: message });
        errors.push(`${name}: ${message}`);
      }
    }

    await Backup.updateOne({ _id: backup._id }, { $set: { restoredAt: new Date(), restoredBy: actor.name } });
    const total = collections.reduce((n, c) => n + c.restored, 0);
    await audit(actor, {
      action: "restore",
      entity: "backup",
      entityId: backup._id,
      ref: backupFileName(backup.key),
      summary: `Restored backup of ${backup.createdAt.toISOString()} · ${total} records in ${collections.length} collections${errors.length ? ` · ${errors.length} collection(s) had errors` : ""} · safety backup ${backupFileName(safety.key)}`,
    });
    return { safetyBackupId: safety._id.toString(), collections, errors };
  });
}

/** Keeps the newest `keep` completed backups and deletes the rest (objects and records). */
export async function pruneBackups(keep: number): Promise<number> {
  await connectDB();
  const limit = Math.max(1, Math.floor(keep) || 1);
  const stale = await Backup.find({ status: "completed" }).sort({ createdAt: -1 }).skip(limit).lean();
  let removed = 0;
  for (const backup of stale) {
    try {
      if (env.spaces.configured) await deleteObject(backup.key);
    } catch (error) {
      console.error("[backup] could not delete object", backup.key, error);
      continue; // keep the record so the next run retries
    }
    await Backup.deleteOne({ _id: backup._id });
    removed++;
  }
  await Backup.deleteMany({ status: "failed", createdAt: { $lt: new Date(Date.now() - 30 * 86_400_000) } });
  return removed;
}
