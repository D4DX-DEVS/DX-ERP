"use server";

import { actionPermission, ActionError, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { backupFileName, createBackup, pruneBackups, restoreBackup, verifyBackup, type RestoreResult } from "@/lib/backup";
import { Backup } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";

export interface VerificationView {
  ok: boolean;
  createdAt: string;
  size: number;
  total: number;
  collections: { name: string; count: number; expected?: number; match: boolean }[];
  missing: string[];
  unknown: string[];
  issues: string[];
}

/** Creates a manual backup and applies the retention limit. */
export async function runBackupNow(): Promise<ActionResult<{ id: string; size: number; pruned: number }>> {
  return runAction(async () => {
    const user = await actionPermission("backup.manage");
    const backup = await createBackup("manual", user);
    const settings = await getSettings();
    const pruned = await pruneBackups(settings.data.backupRetentionCount);
    return { id: backup._id.toString(), size: backup.size, pruned };
  }, "Backup completed");
}

/** Downloads and parses a backup without changing any data (the "test restore"). */
export async function verifyBackupAction(id: string): Promise<ActionResult<VerificationView>> {
  return runAction(async () => {
    const user = await actionPermission("backup.manage");
    if (!isObjectId(id)) throw new ActionError("Backup not found");
    const result = await verifyBackup(id);
    const backup = await Backup.findById(id, { key: 1 }).lean();
    await audit(user, {
      action: "backup",
      entity: "backup",
      entityId: id,
      ref: backup ? backupFileName(backup.key) : undefined,
      summary: `Verified backup (test restore, no data changed) · ${result.ok ? "passed" : "FAILED"} · ${result.total} records in ${result.collections.length} collections`,
    });
    return { ...result, createdAt: result.createdAt.toISOString() };
  });
}

/** Restores a backup. Requires the typed confirmation "RESTORE". */
export async function restoreBackupAction(id: string, confirmation: string): Promise<ActionResult<RestoreResult>> {
  return runAction(async () => {
    const user = await actionPermission("backup.manage");
    if (!isObjectId(id)) throw new ActionError("Backup not found");
    if (confirmation.trim() !== "RESTORE") throw new ActionError('Type RESTORE exactly to confirm.');
    return restoreBackup(id, user);
  }, "Restore finished");
}
