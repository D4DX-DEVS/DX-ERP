"use server";

import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Session, User, type Address, type EmergencyContact } from "@/lib/models";
import { isObjectId, zs } from "@/lib/validation";
import { orNull } from "../staff/_lib/person";

const profileSchema = z.object({
  phone: zs.optText(30),
  personalEmail: zs.optEmail(),
  addrLine1: zs.optText(150),
  addrLine2: zs.optText(150),
  city: zs.optText(80),
  state: zs.optText(80),
  postalCode: zs.optText(20),
  country: zs.optText(80),
  emergencyName: zs.optText(100),
  emergencyRelation: zs.optText(50),
  emergencyPhone: zs.optText(30),
});

/** Self-service update of contact, address and emergency contact (never role, salary or employment fields). */
export async function updateMyProfile(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (user.isSuperAdmin || user.personType === "admin") throw new ActionError("The super admin account has no personal profile to edit.");
    const data = parse(profileSchema, input);

    // An empty field clears the value (`null`); the nested address / emergency contact objects are rebuilt from the form.
    const address: Address = { line1: data.addrLine1, line2: data.addrLine2, city: data.city, state: data.state, postalCode: data.postalCode, country: data.country };
    const emergencyContact: EmergencyContact = { name: data.emergencyName, relation: data.emergencyRelation, phone: data.emergencyPhone };
    await db()
      .update(User)
      .set({
        phone: data.phone ?? null,
        personalEmail: data.personalEmail ?? null,
        address: orNull(address),
        emergencyContact: orNull(emergencyContact),
      })
      .where(eq(User._id, user._id));
    await audit(user, { action: "update", entity: "user", entityId: user._id, ref: user.employeeId, summary: `${user.name} updated their own contact details` });
    return null;
  }, "Profile saved");
}

/** Revokes one of the signed-in user's other sessions. */
export async function revokeMySession(sessionId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(sessionId)) throw new ActionError("Session not found.");
    const [session] = await db()
      .select({ _id: Session._id, sid: Session.sid })
      .from(Session)
      .where(and(eq(Session._id, sessionId), eq(Session.user, user._id), isNull(Session.revokedAt)))
      .limit(1);
    if (!session) throw new ActionError("This session is no longer active.");
    if (session.sid === user.sid) throw new ActionError("This is the session you're using now — use Sign out instead.");
    await db().update(Session).set({ revokedAt: new Date(), revokedReason: "revoked by user" }).where(eq(Session._id, session._id));
    await audit(user, { action: "access", entity: "user", entityId: user._id, ref: user.employeeId, summary: `${user.name} revoked one of their sessions` });
    return null;
  }, "Session revoked");
}

/** Signs the user out of every session except the current one. */
export async function signOutOtherSessions(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    await db()
      .update(Session)
      .set({ revokedAt: new Date(), revokedReason: "signed out other sessions" })
      .where(and(eq(Session.user, user._id), ne(Session.sid, user.sid), isNull(Session.revokedAt)));
    await audit(user, { action: "access", entity: "user", entityId: user._id, ref: user.employeeId, summary: `${user.name} signed out all other sessions` });
    return null;
  }, "Other sessions signed out");
}
