"use server";

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { hashKioskToken, newCodeSalt, newKioskToken, parseNetwork } from "@/lib/domain/kiosk-code";
import { AttendanceKiosk } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId, zs } from "@/lib/validation";
import { saveConfig } from "./helpers";

const MAX_OFFICE_NETWORKS = 10;

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
      .set({ tokenHash: hashKioskToken(token), codeSalt: newCodeSalt(), deviceId: null, boundAt: null, networks: [] })
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

/** Accepts a network (IPv4 address or IPv6 /64) for the same-network rule besides the screens' own. */
export async function allowOfficeNetwork(network: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const net = typeof network === "string" ? parseNetwork(network) : null;
    if (!net) throw new ActionError("That isn't a network address.");
    const current = (await getSettings()).attendance;
    if (current.qrOfficeNetworks.includes(net)) return null;
    if (current.qrOfficeNetworks.length >= MAX_OFFICE_NETWORKS) throw new ActionError(`At most ${MAX_OFFICE_NETWORKS} office networks. Remove one first.`);
    await saveConfig(user, "attendance", "QR office networks", { ...current, qrOfficeNetworks: [...current.qrOfficeNetworks, net] });
    return null;
  }, "Network allowed");
}

export async function removeOfficeNetwork(network: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const current = (await getSettings()).attendance;
    if (!current.qrOfficeNetworks.includes(network)) throw new ActionError("Network not found");
    await saveConfig(user, "attendance", "QR office networks", { ...current, qrOfficeNetworks: current.qrOfficeNetworks.filter((n) => n !== network) });
    return null;
  }, "Network removed");
}
