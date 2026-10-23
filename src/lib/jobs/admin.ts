import "server-only";
import { audit } from "@/lib/audit";
import { createBackup, pruneBackups } from "@/lib/backup";
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { Asset, AuditLog, Notification } from "@/lib/models";
import { notify, notifyPermission, usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addDays, diffDays, fmtDate, todayKey } from "@/lib/time";
import type { Job } from "./registry";

const WARRANTY_DAYS = 30;
const SERVICE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Assets whose warranty ends within 30 days → everyone who manages assets (once per asset + end date). */
async function warrantyReminders(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const assets = await Asset.find(
    { warrantyUntil: { $gte: today, $lte: addDays(today, WARRANTY_DAYS) }, status: { $nin: ["retired", "lost"] } },
    { assetNo: 1, name: 1, warrantyUntil: 1 },
  ).lean();
  if (assets.length === 0) return "no warranties ending soon";
  const recipients = await usersWithPermission("assets.manage");
  if (recipients.length === 0) return "no asset managers to notify";
  for (const a of assets) {
    const until = a.warrantyUntil!;
    const days = diffDays(today, until);
    await notify(recipients, {
      type: "asset",
      title: `Warranty ending: ${a.name}`,
      body: `${a.assetNo} · warranty ends ${fmtDate(until)} (${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}).`,
      link: `/assets/${a._id.toString()}`,
      dedupeKey: `asset-warranty:${a._id.toString()}:${until}`,
    });
  }
  return `${assets.length} warranty reminder(s) sent`;
}

/** Assets whose service is due within 7 days (or overdue) → asset managers (once per asset + due date). */
async function serviceReminders(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const assets = await Asset.find(
    { nextServiceDate: { $lte: addDays(today, SERVICE_DAYS) }, status: { $nin: ["retired", "lost"] } },
    { assetNo: 1, name: 1, nextServiceDate: 1 },
  ).lean();
  if (assets.length === 0) return "no services due";
  const recipients = await usersWithPermission("assets.manage");
  if (recipients.length === 0) return "no asset managers to notify";
  for (const a of assets) {
    const due = a.nextServiceDate!;
    const days = diffDays(today, due);
    await notify(recipients, {
      type: "asset",
      title: `Service ${days < 0 ? "overdue" : "due"}: ${a.name}`,
      body: `${a.assetNo} · service ${days < 0 ? `was due ${fmtDate(due)}` : days === 0 ? "is due today" : `is due ${fmtDate(due)} (in ${days} day${days === 1 ? "" : "s"})`}.`,
      link: `/assets/${a._id.toString()}`,
      priority: days < 0 ? "high" : "normal",
      dedupeKey: `asset-service:${a._id.toString()}:${due}`,
    });
  }
  return `${assets.length} service reminder(s) sent`;
}

/** Daily automatic backup (when enabled and storage is configured), then retention pruning. */
async function automaticBackup(): Promise<string> {
  const settings = await getSettings();
  if (!settings.data.autoBackup) return "automatic backup is off";
  if (!env.spaces.configured) return "skipped: file storage is not configured";
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

/** Applies the configured audit and notification retention (never less than the validated minimums). */
async function retention(): Promise<string> {
  await connectDB();
  const { data } = await getSettings();
  const parts: string[] = [];
  if (Number.isFinite(data.notificationRetentionDays) && data.notificationRetentionDays >= 7) {
    const res = await Notification.deleteMany({ createdAt: { $lt: new Date(Date.now() - data.notificationRetentionDays * DAY_MS) } });
    parts.push(`${res.deletedCount} notification(s)`);
  }
  if (Number.isFinite(data.auditRetentionDays) && data.auditRetentionDays >= 90) {
    const res = await AuditLog.deleteMany({ at: { $lt: new Date(Date.now() - data.auditRetentionDays * DAY_MS) } });
    parts.push(`${res.deletedCount} audit entr${res.deletedCount === 1 ? "y" : "ies"}`);
    if (res.deletedCount > 0) {
      await audit(null, { action: "delete", entity: "audit", ref: "retention", summary: `Removed ${res.deletedCount} audit entries older than ${data.auditRetentionDays} days (retention policy)` });
    }
  }
  return parts.length ? `purged ${parts.join(", ")}` : "nothing to purge";
}

export const adminJobs: Job[] = [
  { name: "asset-warranty-expiry", intervalMinutes: 360, run: warrantyReminders },
  { name: "asset-service-due", intervalMinutes: 360, run: serviceReminders },
  { name: "automatic-backup", intervalMinutes: 24 * 60, run: automaticBackup },
  { name: "data-retention", intervalMinutes: 24 * 60, run: retention },
];
