"use server";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ActionError, actionUser, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { db } from "@/lib/db";
import { workCalendar } from "@/lib/domain/calendar";
import { leaveYearOf } from "@/lib/domain/leave-balance";
import { Attendance, CompOffClaim, LeaveType, User, type ICompOffClaim } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { inList, jsonHas } from "@/lib/sql";
import { addDays, fmtDate, formatDuration, todayKey } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { daysLabel } from "./_lib/format";

/**
 * Comp-off (compensatory leave): staff claim a day off for a weekend or company holiday they worked. The claim is
 * checked against the calendar and that day's attendance, decided by the reporting manager or HR (`leave.approve`),
 * and each approved claim is a credit on the comp-off leave type for the leave year (balances are computed from
 * approved claims). Unused credits lapse when the leave year resets, like other leave without carry-forward.
 */

/** Credit for the hours worked that day, using the company's full- / half-day thresholds. */
function creditFor(workMinutes: number, attendance: { fullDayMinutes: number; halfDayMinutes: number }): number {
  if (workMinutes >= attendance.fullDayMinutes) return 1;
  if (workMinutes >= attendance.halfDayMinutes) return 0.5;
  return 0;
}

/** Checks a work date for a person and returns the credit it earns; throws a readable error otherwise. */
async function eligibleCredit(userId: string, workDate: string): Promise<{ days: number; workMinutes: number }> {
  const settings = await getSettings();
  const [cal, [att]] = await Promise.all([
    workCalendar(settings, workDate, workDate),
    db()
      .select({ checkIn: Attendance.checkIn, checkOut: Attendance.checkOut, workMinutes: Attendance.workMinutes })
      .from(Attendance)
      .where(and(eq(Attendance.user, userId), eq(Attendance.date, workDate)))
      .limit(1),
  ]);
  if (cal.isWorkingDay(workDate)) {
    throw new ActionError(`${fmtDate(workDate, "EEE d MMM yyyy")} is a working day. Comp-off is only for work on a weekend or company holiday.`, { workDate: "Not a weekend or holiday" });
  }
  if (!att?.checkIn) throw new ActionError(`There's no attendance on ${fmtDate(workDate)}. Check in when you work on a weekend or holiday so the day can be claimed.`, { workDate: "No attendance that day" });
  if (!att.checkOut) throw new ActionError(`The check-out for ${fmtDate(workDate)} is missing. Correct that day's attendance first.`, { workDate: "Check-out missing" });
  const days = creditFor(att.workMinutes, settings.attendance);
  if (days === 0) {
    throw new ActionError(`You worked ${formatDuration(att.workMinutes)} on ${fmtDate(workDate)}; a comp-off needs at least ${formatDuration(settings.attendance.halfDayMinutes)} (half day).`, {
      workDate: "Not enough hours worked",
    });
  }
  return { days, workMinutes: att.workMinutes };
}

const claimSchema = z.object({ workDate: zs.date("Date worked"), reason: zs.text("What you worked on", 500) });

export async function claimCompOff(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isStaff(user)) throw new ActionError("The super admin account has no leave of its own.");
    const data = parse(claimSchema, input);
    const settings = await getSettings();
    const today = todayKey();
    if (data.workDate > today) throw new ActionError("Claim a comp-off after you have worked the day.", { workDate: "In the future" });
    const window = settings.leave.compOffClaimDays;
    if (data.workDate < addDays(today, -window)) {
      throw new ActionError(`Comp-off must be claimed within ${daysLabel(window)} of working the day.`, { workDate: `More than ${window} days ago` });
    }

    const [[type], [existing]] = await Promise.all([
      db()
        .select({ _id: LeaveType._id, name: LeaveType.name })
        .from(LeaveType)
        .where(and(eq(LeaveType.kind, "comp_off"), eq(LeaveType.active, true), jsonHas(LeaveType.applicableTo, user.personType)))
        .orderBy(asc(LeaveType.order))
        .limit(1),
      db()
        .select({ claimNo: CompOffClaim.claimNo, status: CompOffClaim.status })
        .from(CompOffClaim)
        .where(and(eq(CompOffClaim.user, user._id), eq(CompOffClaim.workDate, data.workDate), inList(CompOffClaim.status, ["pending", "approved"])))
        .limit(1),
    ]);
    if (!type) throw new ActionError("Comp-off isn't available for your role. Ask HR.");
    if (existing) throw new ActionError(`You already claimed ${fmtDate(data.workDate)} (${existing.claimNo}, ${existing.status}).`, { workDate: "Already claimed" });
    const { days, workMinutes } = await eligibleCredit(user._id, data.workDate);

    // Credit lands in the leave year of the day worked, or the current one if that year has already ended.
    const creditYear = Math.max(leaveYearOf(data.workDate, settings), leaveYearOf(today, settings));
    const manager = user.reportingManagerId;
    const [doc] = await db()
      .insert(CompOffClaim)
      .values({ claimNo: await nextNumber("compoff", ID_PREFIX.compOff, 4), user: user._id, leaveType: type._id, workDate: data.workDate, days, workMinutes, reason: data.reason, manager, creditYear })
      .returning();

    const message = {
      type: "leave",
      title: `Comp-off claim · ${user.name}`,
      body: `${daysLabel(days)} for working ${fmtDate(data.workDate, "EEE d MMM")} (${formatDuration(workMinutes)}). ${data.reason}`.slice(0, 500),
      link: "/leave/approvals#comp-off",
      actionable: true,
    };
    if (manager) await notify([manager], message);
    else await notifyPermission("leave.approve", message, [user._id]);
    await audit(user, { action: "submit", entity: "comp_off", entityId: doc._id, ref: doc.claimNo, summary: `Claimed ${daysLabel(days)} comp-off for working ${fmtDate(data.workDate)}` });
    return { id: doc._id };
  }, "Comp-off claim submitted");
}

export async function withdrawCompOff(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Claim not found.");
    const [claim] = await db()
      .update(CompOffClaim)
      .set({ status: "cancelled", decidedBy: user._id, decidedByName: user.name, decidedAt: new Date(), decisionNote: "Withdrawn" })
      .where(and(eq(CompOffClaim._id, id), eq(CompOffClaim.user, user._id), eq(CompOffClaim.status, "pending")))
      .returning();
    if (!claim) throw new ActionError("Only a pending claim can be withdrawn. Reload to see its status.");
    await notify([claim.manager], { type: "leave", title: `Comp-off claim withdrawn · ${user.name}`, body: `${claim.claimNo} · ${fmtDate(claim.workDate)}`, link: "/leave/approvals#comp-off" });
    await audit(user, { action: "cancel", entity: "comp_off", entityId: claim._id, ref: claim.claimNo, summary: `Withdrew comp-off claim ${claim.claimNo} (${fmtDate(claim.workDate)})` });
    return null;
  }, "Claim withdrawn");
}

/** A claim the actor may decide: pending, not their own, and they are the person's current reporting manager or hold `leave.approve`. */
async function decidableClaim(actor: CurrentUser, id: string): Promise<{ claim: ICompOffClaim; who: string }> {
  if (!isObjectId(id)) throw new ActionError("Claim not found.");
  const [claim] = await db().select().from(CompOffClaim).where(eq(CompOffClaim._id, id)).limit(1);
  if (!claim) throw new ActionError("Claim not found.");
  if (claim.status !== "pending") throw new ActionError(`This claim is already ${claim.status}.`);
  if (claim.user === actor._id) throw new ActionError("You can't decide your own comp-off claim.");
  const [person] = await db().select({ name: User.name, reportingManager: User.reportingManager }).from(User).where(eq(User._id, claim.user)).limit(1);
  if (!can(actor, "leave.approve") && person?.reportingManager !== actor.id) throw new ActionError("You don't have permission to decide this claim.");
  return { claim, who: person?.name ?? "the applicant" };
}

export async function approveCompOff(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const { claim, who } = await decidableClaim(actor, id);
    // Attendance may have been corrected since the claim: credit what the day supports now.
    const { days, workMinutes } = await eligibleCredit(claim.user, claim.workDate);
    const comment = note?.trim().slice(0, 500) || undefined;
    const [updated] = await db()
      .update(CompOffClaim)
      .set({ status: "approved", days, workMinutes, decidedBy: actor._id, decidedByName: actor.name, decidedAt: new Date(), decisionNote: comment })
      .where(and(eq(CompOffClaim._id, claim._id), eq(CompOffClaim.status, "pending")))
      .returning();
    if (!updated) throw new ActionError("This claim was just decided by someone else.");
    await notify([claim.user], {
      type: "leave",
      title: "Comp-off approved",
      body: `${daysLabel(days)} of comp-off for ${fmtDate(claim.workDate)} was approved by ${actor.name} and added to your ${claim.creditYear} balance.${comment ? ` Note: ${comment}` : ""}`,
      link: "/leave",
    });
    await audit(actor, {
      action: "approve",
      entity: "comp_off",
      entityId: claim._id,
      ref: claim.claimNo,
      summary: `Approved ${who}'s comp-off ${claim.claimNo}: ${daysLabel(days)} for ${fmtDate(claim.workDate)}`,
      changes: [{ field: "status", from: "pending", to: "approved" }],
    });
    return null;
  }, "Comp-off approved");
}

export async function rejectCompOff(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const comment = parse(zs.text("Reason", 500), reason);
    const { claim, who } = await decidableClaim(actor, id);
    const [updated] = await db()
      .update(CompOffClaim)
      .set({ status: "rejected", decidedBy: actor._id, decidedByName: actor.name, decidedAt: new Date(), decisionNote: comment })
      .where(and(eq(CompOffClaim._id, claim._id), eq(CompOffClaim.status, "pending")))
      .returning();
    if (!updated) throw new ActionError("This claim was just decided by someone else.");
    await notify([claim.user], { type: "leave", title: "Comp-off rejected", body: `Your comp-off claim for ${fmtDate(claim.workDate)} was rejected by ${actor.name}. Reason: ${comment}`, link: "/leave", priority: "high" });
    await audit(actor, {
      action: "reject",
      entity: "comp_off",
      entityId: claim._id,
      ref: claim.claimNo,
      summary: `Rejected ${who}'s comp-off ${claim.claimNo} (${fmtDate(claim.workDate)}): ${comment}`,
      changes: [{ field: "status", from: "pending", to: "rejected" }],
    });
    return null;
  }, "Comp-off rejected");
}

/** HR takes back an approved credit (e.g. approved by mistake). If it was already used, the balance shows negative. */
export async function revokeCompOff(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    if (!can(actor, "leave.manage") && !can(actor, "leave.approve")) throw new ActionError("You don't have permission to revoke comp-off.");
    const comment = parse(zs.text("Reason", 500), reason);
    if (!isObjectId(id)) throw new ActionError("Claim not found.");
    const [owner] = await db().select({ user: CompOffClaim.user }).from(CompOffClaim).where(eq(CompOffClaim._id, id)).limit(1);
    if (!owner) throw new ActionError("Claim not found.");
    if (owner.user === actor._id) throw new ActionError("You can't revoke your own comp-off.");
    const [claim] = await db()
      .update(CompOffClaim)
      .set({ status: "cancelled", decidedBy: actor._id, decidedByName: actor.name, decidedAt: new Date(), decisionNote: `Revoked: ${comment}`.slice(0, 500) })
      .where(and(eq(CompOffClaim._id, id), eq(CompOffClaim.status, "approved")))
      .returning();
    if (!claim) throw new ActionError("Only an approved claim can be revoked. Reload to see its status.");
    await notify([claim.user], { type: "leave", title: "Comp-off revoked", body: `${daysLabel(claim.days)} of comp-off for ${fmtDate(claim.workDate)} was revoked by ${actor.name}. Reason: ${comment}`, link: "/leave", priority: "high" }, [actor._id]);
    await audit(actor, {
      action: "cancel",
      entity: "comp_off",
      entityId: claim._id,
      ref: claim.claimNo,
      summary: `Revoked comp-off ${claim.claimNo} (${fmtDate(claim.workDate)}): ${comment}`,
      changes: [{ field: "status", from: "approved", to: "cancelled" }],
    });
    return null;
  }, "Comp-off revoked");
}
