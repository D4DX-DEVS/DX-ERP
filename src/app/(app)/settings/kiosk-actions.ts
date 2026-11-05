"use server";

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hashKioskToken, newCodeSalt, newKioskToken } from "@/lib/domain/kiosk-code";
import { AttendanceKiosk } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId, zs } from "@/lib/validation";

/** Link of a QR attendance screen, as a path: the admin's browser adds its own origin. Shown once, never stored. */
const linkPath = (token: string) => `/kiosk/${token}`;

export async function createKiosk(input: Record<string, unknown>): Promise<ActionResult<{ path: string }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const { name } = parse(z.object({ name: zs.text("Screen name", 60) }), input);
    const token = newKioskToken();
    const [kiosk] = await db()
      .insert(AttendanceKiosk)
      .values({ name, tokenHash: hashKioskToken(token), codeSalt: newCodeSalt(), createdBy: user._id })
      .returning({ id: AttendanceKiosk._id });
    await audit(user, { action: "create", entity: "attendance_kiosk", entityId: kiosk.id, ref: name, summary: `Added QR attendance screen "${name}"` });
    return { path: linkPath(token) };
  }, "Screen added");
}

/** Replaces the link: the old link, the computer it was opened on and its QR codes all stop working. */
export async function renewKioskLink(id: string): Promise<ActionResult<{ path: string }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Screen not found");
    const token = newKioskToken();
    const [kiosk] = await db()
      .update(AttendanceKiosk)
      .set({ tokenHash: hashKioskToken(token), codeSalt: newCodeSalt(), deviceId: null, boundAt: null })
      .where(eq(AttendanceKiosk._id, id))
      .returning({ name: AttendanceKiosk.name });
    if (!kiosk) throw new ActionError("Screen not found");
    await audit(user, { action: "update", entity: "attendance_kiosk", entityId: id, ref: kiosk.name, summary: `New link for QR attendance screen "${kiosk.name}" (old link disconnected)` });
    return { path: linkPath(token) };
  }, "New link created");
}

export async function deleteKiosk(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Screen not found");
    // Staff could no longer check in at all: keep at least one working screen while QR check-in is on.
    if ((await getSettings()).attendance.qrCheckIn) {
      const [other] = await db()
        .select({ id: AttendanceKiosk._id })
        .from(AttendanceKiosk)
        .where(and(ne(AttendanceKiosk._id, id), isNotNull(AttendanceKiosk.deviceId)))
        .limit(1);
      if (!other) throw new ActionError("This is the only active QR screen. Turn off QR check-in first, or set up another screen.");
    }
    const [kiosk] = await db().delete(AttendanceKiosk).where(eq(AttendanceKiosk._id, id)).returning({ name: AttendanceKiosk.name });
    if (!kiosk) throw new ActionError("Screen not found");
    await audit(user, { action: "delete", entity: "attendance_kiosk", entityId: id, ref: kiosk.name, summary: `Removed QR attendance screen "${kiosk.name}"` });
    return null;
  }, "Screen removed");
}
