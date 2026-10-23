"use server";

import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { Session, User } from "@/lib/models";
import { isObjectId, zs } from "@/lib/validation";

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

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    const put = (key: string, value: unknown) => {
      if (value === undefined || value === "") unset[key] = "";
      else set[key] = value;
    };
    put("phone", data.phone);
    put("personalEmail", data.personalEmail);
    put("address.line1", data.addrLine1);
    put("address.line2", data.addrLine2);
    put("address.city", data.city);
    put("address.state", data.state);
    put("address.postalCode", data.postalCode);
    put("address.country", data.country);
    put("emergencyContact.name", data.emergencyName);
    put("emergencyContact.relation", data.emergencyRelation);
    put("emergencyContact.phone", data.emergencyPhone);

    await User.updateOne({ _id: user._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { runValidators: true });
    await audit(user, { action: "update", entity: "user", entityId: user._id, ref: user.employeeId, summary: `${user.name} updated their own contact details` });
    return null;
  }, "Profile saved");
}

/** Revokes one of the signed-in user's other sessions. */
export async function revokeMySession(sessionId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(sessionId)) throw new ActionError("Session not found.");
    const session = await Session.findOne({ _id: sessionId, user: user._id, revokedAt: null }, { sid: 1 }).lean();
    if (!session) throw new ActionError("This session is no longer active.");
    if (session.sid === user.sid) throw new ActionError("This is the session you're using now — use Sign out instead.");
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date(), revokedReason: "revoked by user" } });
    await audit(user, { action: "access", entity: "user", entityId: user._id, ref: user.employeeId, summary: `${user.name} revoked one of their sessions` });
    return null;
  }, "Session revoked");
}

/** Signs the user out of every session except the current one. */
export async function signOutOtherSessions(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    await Session.updateMany({ user: user._id, sid: { $ne: user.sid }, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: "signed out other sessions" } });
    await audit(user, { action: "access", entity: "user", entityId: user._id, ref: user.employeeId, summary: `${user.name} signed out all other sessions` });
    return null;
  }, "Other sessions signed out");
}
