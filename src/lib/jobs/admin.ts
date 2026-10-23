import "server-only";
import { and, gte, lt, lte } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { createBackup, pruneBackups } from "@/lib/backup";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { Asset, AuditLog, LoginAttempt, Notification, Session } from "@/lib/models";
import { notifyPermission, usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { notInList } from "@/lib/sql";
import { addDays, diffDays, fmtDate, todayKey } from "@/lib/time";
import { notifyBatch } from "./batch";
import type { Job } from "./registry";

const WARRANTY_DAYS = 30;
const SERVICE_DAYS = 7;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Assets whose warranty ends within 30 days → everyone who manages assets (once per asset + end date). */
async function warrantyReminders(): Promise<string> {
  const today = todayKey();
  const assets = await db()
    .select({ id: Asset._id, assetNo: Asset.assetNo, name: Asset.name, warrantyUntil: Asset.warrantyUntil })
    .from(Asset)
    .where(and(gte(Asset.warrantyUntil, today), lte(Asset.warrantyUntil, addDays(today, WARRANTY_DAYS)), notInList(Asset.status, ["retired", "lost"])));
  if (assets.length === 0) return "no warranties ending soon";
  const recipients = await usersWithPermission("assets.manage");
  if (recipients.length === 0) return "no asset managers to notify";
  await notifyBatch(
    assets.map((a) => {
      const until = a.warrantyUntil!;
      const days = diffDays(today, until);
      return {
        recipients,
        input: {
          type: "asset",
          title: `Warranty ending: ${a.name}`,
          body: `${a.assetNo} · warranty ends ${fmtDate(until)} (${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}).`,
          link: `/assets/${a.id}`,
          dedupeKey: `asset-warranty:${a.id}:${until}`,
        },
      };
    }),
  );
  return `${assets.length} warranty reminder(s) sent`;
}

/** Assets whose service is due within 7 days (or overdue) → asset managers (once per asset + due date). */
async function serviceReminders(): Promise<string> {
  const today = todayKey();
  const assets = await db()
    .select({ id: Asset._id, assetNo: Asset.assetNo, name: Asset.name, nextServiceDate: Asset.nextServiceDate })
    .from(Asset)
    .where(and(lte(Asset.nextServiceDate, addDays(today, SERVICE_DAYS)), notInList(Asset.status, ["retired", "lost"])));
  if (assets.length === 0) return "no services due";
  const recipients = await usersWithPermission("assets.manage");
  if (recipients.length === 0) return "no asset managers to notify";
  await notifyBatch(
    assets.map((a) => {
      const due = a.nextServiceDate!;
      const days = diffDays(today, due);
      return {
        recipients,
        input: {
          type: "asset",
          title: `Service ${days < 0 ? "overdue" : "due"}: ${a.name}`,
          body: `${a.assetNo} · service ${days < 0 ? `was due ${fmtDate(due)}` : days === 0 ? "is due today" : `is due ${fmtDate(due)} (in ${days} day${days === 1 ? "" : "s"})`}.`,
          link: `/assets/${a.id}`,
          priority: days < 0 ? ("high" as const) : ("normal" as const),
          dedupeKey: `asset-service:${a.id}:${due}`,
        },
      };
    }),
  );
  return `${assets.length} service reminder(s) sent`;
}

/** Daily automatic backup (when enabled and storage is configured), then retention pruning. */
async function automaticBackup(): Promise<string> {
  const settings = await getSettings();
  if (!settings.data.autoBackup) return "automatic backup is off";
  if (!env.storage.configured) return "skipped: file storage is not configured";
  try {
    const backup = await createBackup("scheduled");
    const pruned = await pruneBackups(settings.data.backupRetentionCount);
    return `backup created (${backup.collections.reduce((n, c) => n + c.count, 0)} records)${pruned ? `, ${pruned} old backup(s) removed` : ""}`;
  } catch (error) {
    await notifyPermission("backup.manage", {
      type: "system",
      title: "Automatic backup failed",
      body: "Tonight's backup could not be completed. Open Configuration → Backup & restore for details and run one manually.",
      link: "/settings?section=backup",
      priority: "high",
      dedupeKey: `backup-failed:${todayKey()}`,
    });
    throw error;
  }
}

/**
 * Applies the configured audit and notification retention (never less than the validated minimums), and purges
 * expired sessions (a day past `expiresAt`) and login attempts older than an hour — the clean-up MongoDB's TTL indexes did.
 */
async function retention(): Promise<string> {
  const { data } = await getSettings();
  const parts: string[] = [];
  if (Number.isFinite(data.notificationRetentionDays) && data.notificationRetentionDays >= 7) {
    const res = await db()
      .delete(Notification)
      .where(lt(Notification.createdAt, new Date(Date.now() - data.notificationRetentionDays * DAY_MS)))
      .run();
    parts.push(`${res.meta.changes} notification(s)`);
  }
  if (Number.isFinite(data.auditRetentionDays) && data.auditRetentionDays >= 90) {
    const res = await db()
      .delete(AuditLog)
      .where(lt(AuditLog.at, new Date(Date.now() - data.auditRetentionDays * DAY_MS)))
      .run();
    const deleted = res.meta.changes;
    parts.push(`${deleted} audit entr${deleted === 1 ? "y" : "ies"}`);
    if (deleted > 0) {
      await audit(null, { action: "delete", entity: "audit", ref: "retention", summary: `Removed ${deleted} audit entries older than ${data.auditRetentionDays} days (retention policy)` });
    }
  }
  const sessions = await db().delete(Session).where(lt(Session.expiresAt, new Date(Date.now() - DAY_MS))).run();
  if (sessions.meta.changes > 0) parts.push(`${sessions.meta.changes} expired session(s)`);
  const attempts = await db().delete(LoginAttempt).where(lt(LoginAttempt.at, new Date(Date.now() - HOUR_MS))).run();
  if (attempts.meta.changes > 0) parts.push(`${attempts.meta.changes} login attempt(s)`);
  return parts.length ? `purged ${parts.join(", ")}` : "nothing to purge";
}

export const adminJobs: Job[] = [
  { name: "asset-warranty-expiry", intervalMinutes: 360, run: warrantyReminders },
  { name: "asset-service-due", intervalMinutes: 360, run: serviceReminders },
  { name: "automatic-backup", intervalMinutes: 24 * 60, run: automaticBackup },
  { name: "data-retention", intervalMinutes: 24 * 60, run: retention },
];
