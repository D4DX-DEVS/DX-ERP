"use server";

import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { ActionError, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { clientNetwork, kioskCookie } from "@/lib/domain/kiosk";
import { hashKioskToken, withNetwork } from "@/lib/domain/kiosk-code";
import { AttendanceKiosk, newId } from "@/lib/models";

/** Binds an office QR attendance screen to this browser — only while the screen is not bound yet. */
export async function activateKiosk(token: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    if (typeof token !== "string" || token.length > 100) throw new ActionError("This link is not valid.");
    const now = new Date();
    const deviceId = newId();
    const [kiosk] = await db()
      .update(AttendanceKiosk)
      .set({ deviceId, boundAt: now, lastSeenAt: now, networks: withNetwork([], await clientNetwork(), now) })
      .where(and(eq(AttendanceKiosk.tokenHash, hashKioskToken(token)), isNull(AttendanceKiosk.deviceId)))
      .returning({ id: AttendanceKiosk._id, name: AttendanceKiosk.name });
    if (!kiosk) throw new ActionError("This link is no longer valid or is already active on another screen. Ask an admin for a new link.");
    const cookie = await kioskCookie(kiosk.id, deviceId);
    (await cookies()).set(cookie.name, cookie.value, cookie.options);
    await audit(null, { action: "config", entity: "attendance_kiosk", entityId: kiosk.id, ref: kiosk.name, summary: `QR attendance screen "${kiosk.name}" activated on a computer` });
    return null;
  }, "Screen activated");
}
