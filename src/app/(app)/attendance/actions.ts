"use server";

import { z } from "zod";
import { ActionError, actionPermission, actionUser, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { recalcAttendanceDay } from "@/lib/domain/attendance-calc";
import { workCalendar } from "@/lib/domain/calendar";
import { Attendance, AttendanceCorrection, LeaveRequest, Movement, User, type IAttendanceCorrection } from "@/lib/models";
import { managerOf, notify, usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtTime, todayKey, zonedDateTime } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { STAFF_TYPES } from "./_lib/access";
import { leaveDaysIn } from "./_lib/leave-days";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function historyEntry(user: Pick<CurrentUser, "_id" | "name">, action: string, note?: string, from?: string, to?: string) {
  return { action, by: user._id, byName: user.name, at: new Date(), note, from, to };
}

/** Signed-in staff member (the super admin account has no attendance of its own). */
async function staffUser(): Promise<CurrentUser> {
  const user = await actionUser();
  if (!isStaff(user)) throw new ActionError("The super admin account has no attendance of its own.");
  return user;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

/** Check-out needs a check-in and must be later than it. */
function assertTimesConsistent(checkIn?: Date | null, checkOut?: Date | null): void {
  if (checkOut && !checkIn) throw new ActionError("A check-out needs a check-in. Enter the check-in time too.", { checkIn: "Required with a check-out" });
  if (checkIn && checkOut && checkOut.getTime() <= checkIn.getTime()) throw new ActionError("Check-out must be later than check-in.", { checkOut: "Must be after check-in" });
}

function span(checkIn?: Date | null, checkOut?: Date | null): string {
  return `${fmtTime(checkIn)} – ${fmtTime(checkOut)}`;
}

/* ------------------------------------------------------------------ */
/* Self service: check-in / check-out / breaks (FRS §7.1)              */
/* ------------------------------------------------------------------ */

export async function checkIn(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    const settings = await getSettings();
    if (!settings.attendance.allowSelfCheckIn) throw new ActionError("Self check-in is turned off. Ask HR to record your attendance.");
    const today = todayKey();
    const leave = await LeaveRequest.findOne({ user: user._id, status: "approved", halfDay: false, startDate: { $lte: today }, endDate: { $gte: today } }, { startDate: 1, endDate: 1 }).lean();
    // Only blocks when today is actually a leave day (weekends / holidays inside the range don't count).
    if (leave && leaveDaysIn(settings, await workCalendar(settings, today, today), today, today).length > 0) {
      throw new ActionError("You are on approved leave today. Cancel the leave first if you are working.");
    }

    const existing = await Attendance.findOne({ user: user._id, date: today });
    if (existing?.checkIn) throw new ActionError("You have already checked in today.");
    if (existing?.locked) throw new ActionError("Today's record is locked. Request a correction instead.");

    const now = new Date();
    try {
      if (existing) {
        existing.checkIn = now;
        existing.source = "self";
        existing.history.push(historyEntry(user, "check_in"));
        await existing.save();
      } else {
        await Attendance.create({ user: user._id, date: today, checkIn: now, source: "self", history: [historyEntry(user, "check_in")] });
      }
    } catch (error) {
      if (isDuplicateKey(error)) throw new ActionError("You have already checked in today.");
      throw error;
    }
    await recalcAttendanceDay(user._id, today);
    return null;
  }, "Checked in");
}

export async function checkOut(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    const today = todayKey();
    const att = await Attendance.findOne({ user: user._id, date: today });
    if (!att?.checkIn) {
      const open = await Attendance.findOne({ user: user._id, checkIn: { $ne: null }, checkOut: null, date: { $lt: today } }, { date: 1 }).sort({ date: -1 }).lean();
      if (open) throw new ActionError(`You haven't checked in today, and ${fmtDate(open.date)} has no check-out. Request a correction for that day.`);
      throw new ActionError("You haven't checked in today.");
    }
    if (att.checkOut) throw new ActionError("You have already checked out today.");
    if (att.locked) throw new ActionError("Today's record is locked. Request a correction instead.");

    // A temporary departure never ends the working day (FRS §8.11): return from the movement first.
    const openMovement = await Movement.findOne({ user: user._id, status: "out" }, { movementNo: 1 }).lean();
    if (openMovement) throw new ActionError(`You have an open movement (${openMovement.movementNo}). Record your return before checking out.`);

    const now = new Date();
    const openBreak = att.breaks.find((b) => !b.end);
    if (openBreak) openBreak.end = now;
    att.checkOut = now;
    att.history.push(historyEntry(user, "check_out", openBreak ? "Open break closed automatically" : undefined));
    await att.save();
    await recalcAttendanceDay(user._id, today);
    return null;
  }, "Checked out");
}

async function openDay(user: CurrentUser) {
  const att = await Attendance.findOne({ user: user._id, date: todayKey() });
  if (!att?.checkIn) throw new ActionError("Check in first.");
  if (att.checkOut) throw new ActionError("You have already checked out today.");
  if (att.locked) throw new ActionError("Today's record is locked. Request a correction instead.");
  return att;
}

export async function startBreak(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    const att = await openDay(user);
    if (att.breaks.some((b) => !b.end)) throw new ActionError("A break is already running.");
    att.breaks.push({ start: new Date() });
    att.history.push(historyEntry(user, "break_start"));
    await att.save();
    await recalcAttendanceDay(user._id, att.date);
    return null;
  }, "Break started");
}

export async function endBreak(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    const att = await openDay(user);
    const running = att.breaks.find((b) => !b.end);
    if (!running) throw new ActionError("No break is running.");
    running.end = new Date();
    att.history.push(historyEntry(user, "break_end"));
    await att.save();
    await recalcAttendanceDay(user._id, att.date);
    return null;
  }, "Break ended");
}

/* ------------------------------------------------------------------ */
/* Correction requests (FRS §7.1, §7.2)                                */
/* ------------------------------------------------------------------ */

const correctionSchema = z.object({
  date: zs.date("Date"),
  checkIn: zs.optTime(),
  checkOut: zs.optTime(),
  reason: zs.text("Reason", 1000),
});

export async function requestCorrection(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await staffUser();
    const data = parse(correctionSchema, input);
    const now = new Date();
    if (data.date > todayKey()) throw new ActionError("You can't request a correction for a future date.", { date: "Pick today or an earlier date" });
    if (!data.checkIn && !data.checkOut) throw new ActionError("Enter the check-in or check-out time you want recorded.", { checkIn: "Enter at least one time" });

    const att = await Attendance.findOne({ user: user._id, date: data.date });
    const requestedCheckIn = data.checkIn ? zonedDateTime(data.date, data.checkIn) : undefined;
    const requestedCheckOut = data.checkOut ? zonedDateTime(data.date, data.checkOut) : undefined;
    if (requestedCheckIn && requestedCheckIn.getTime() > now.getTime()) throw new ActionError("The check-in time can't be in the future.", { checkIn: "In the future" });
    if (requestedCheckOut && requestedCheckOut.getTime() > now.getTime()) throw new ActionError("The check-out time can't be in the future.", { checkOut: "In the future" });
    assertTimesConsistent(requestedCheckIn ?? att?.checkIn, requestedCheckOut ?? att?.checkOut);

    if (await AttendanceCorrection.exists({ user: user._id, date: data.date, status: "pending" })) {
      throw new ActionError("A correction for this date is already waiting for a decision.", { date: "Already pending" });
    }

    const correction = await AttendanceCorrection.create({
      user: user._id,
      date: data.date,
      attendance: att?._id,
      requestedCheckIn,
      requestedCheckOut,
      original: { checkIn: att?.checkIn, checkOut: att?.checkOut, status: att?.status },
      reason: data.reason,
    });

    const approvers = [await managerOf(user._id), ...(await usersWithPermission("attendance.approve"))];
    const changes = [requestedCheckIn && `check-in ${fmtTime(requestedCheckIn)}`, requestedCheckOut && `check-out ${fmtTime(requestedCheckOut)}`].filter(Boolean).join(", ");
    await notify(
      approvers,
      {
        type: "attendance",
        title: `Attendance correction · ${user.name}`,
        body: `${fmtDate(data.date)}: ${changes}. Reason: ${data.reason}`.slice(0, 500),
        link: "/attendance/corrections",
        actionable: true,
      },
      [user._id],
    );
    await audit(user, { action: "submit", entity: "attendance_correction", entityId: correction._id, ref: data.date, summary: `Requested an attendance correction for ${fmtDate(data.date)}` });
    return { id: correction._id.toString() };
  }, "Correction request submitted");
}

export async function cancelCorrection(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    if (!isObjectId(id)) throw new ActionError("Request not found.");
    const res = await AttendanceCorrection.findOneAndUpdate({ _id: id, user: user._id, status: "pending" }, { $set: { status: "cancelled" } }, { returnDocument: "after" });
    if (!res) throw new ActionError("This request can no longer be cancelled.");
    await audit(user, { action: "cancel", entity: "attendance_correction", entityId: res._id, ref: res.date, summary: `Cancelled the attendance correction for ${fmtDate(res.date)}` });
    return null;
  }, "Request cancelled");
}

/** Loads a pending correction the actor may decide (reporting manager of the requester, or `attendance.approve`; never their own). */
async function decidableCorrection(actor: CurrentUser, id: string): Promise<IAttendanceCorrection> {
  if (!isObjectId(id)) throw new ActionError("Request not found.");
  const correction = await AttendanceCorrection.findById(id).lean();
  if (!correction) throw new ActionError("Request not found.");
  if (correction.status !== "pending") throw new ActionError(`This request was already ${correction.status}.`);
  if (correction.user.equals(actor._id)) throw new ActionError("You can't decide your own request.");
  if (!can(actor, "attendance.approve")) {
    const isManager = await User.exists({ _id: correction.user, reportingManager: actor._id });
    if (!isManager) throw new ActionError("You don't have permission to decide this request.");
  }
  return correction;
}

/** Writes the approved times onto the day (creating it when missing) and recalculates. */
async function applyCorrection(actor: CurrentUser, correction: IAttendanceCorrection) {
  let att = await Attendance.findOne({ user: correction.user, date: correction.date });
  const before = { checkIn: att?.checkIn, checkOut: att?.checkOut };
  if (!att) {
    att = new Attendance({ user: correction.user, date: correction.date, source: "correction", history: [] });
  }
  if (correction.requestedCheckIn) att.checkIn = correction.requestedCheckIn;
  if (correction.requestedCheckOut) att.checkOut = correction.requestedCheckOut;
  assertTimesConsistent(att.checkIn, att.checkOut);
  att.source = "correction";
  if (att.checkOut) {
    for (const b of att.breaks) if (!b.end) b.end = att.checkOut;
  }
  att.history.push(historyEntry(actor, "correction_approved", correction.reason, span(before.checkIn, before.checkOut), span(att.checkIn, att.checkOut)));
  await att.save();
  await recalcAttendanceDay(correction.user, correction.date);
  return att;
}

export async function approveCorrection(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const correction = await decidableCorrection(actor, id);
    const reviewNote = note?.trim().slice(0, 1000) || undefined;
    const claimed = await AttendanceCorrection.findOneAndUpdate(
      { _id: correction._id, status: "pending" },
      { $set: { status: "approved", reviewer: actor._id, reviewerName: actor.name, reviewedAt: new Date(), reviewNote } },
      { returnDocument: "after" },
    ).lean();
    if (!claimed) throw new ActionError("This request was already decided.");

    try {
      const att = await applyCorrection(actor, correction);
      await AttendanceCorrection.updateOne({ _id: correction._id }, { $set: { attendance: att._id } });
    } catch (error) {
      await AttendanceCorrection.updateOne({ _id: correction._id }, { $set: { status: "pending" }, $unset: { reviewer: 1, reviewerName: 1, reviewedAt: 1, reviewNote: 1 } });
      throw error;
    }

    const who = await User.findById(correction.user, { name: 1, employeeId: 1 }).lean();
    await audit(actor, {
      action: "approve",
      entity: "attendance_correction",
      entityId: correction._id,
      ref: `${who?.employeeId ?? ""} ${correction.date}`.trim(),
      summary: `Approved ${who?.name ?? "a"} attendance correction for ${fmtDate(correction.date)}`,
      changes: [
        { field: "checkIn", from: correction.original.checkIn, to: correction.requestedCheckIn },
        { field: "checkOut", from: correction.original.checkOut, to: correction.requestedCheckOut },
      ],
    });
    await notify([correction.user], {
      type: "attendance",
      title: "Attendance correction approved",
      body: `Your correction for ${fmtDate(correction.date)} was approved by ${actor.name}.${reviewNote ? ` Note: ${reviewNote}` : ""}`,
      link: "/attendance",
    });
    return null;
  }, "Correction approved");
}

export async function rejectCorrection(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const note = parse(zs.text("Reason", 1000), reason);
    const correction = await decidableCorrection(actor, id);
    const claimed = await AttendanceCorrection.findOneAndUpdate(
      { _id: correction._id, status: "pending" },
      { $set: { status: "rejected", reviewer: actor._id, reviewerName: actor.name, reviewedAt: new Date(), reviewNote: note } },
      { returnDocument: "after" },
    ).lean();
    if (!claimed) throw new ActionError("This request was already decided.");

    const who = await User.findById(correction.user, { name: 1, employeeId: 1 }).lean();
    await audit(actor, {
      action: "reject",
      entity: "attendance_correction",
      entityId: correction._id,
      ref: `${who?.employeeId ?? ""} ${correction.date}`.trim(),
      summary: `Rejected ${who?.name ?? "a"} attendance correction for ${fmtDate(correction.date)}: ${note}`,
    });
    await notify([correction.user], {
      type: "attendance",
      title: "Attendance correction rejected",
      body: `Your correction for ${fmtDate(correction.date)} was rejected by ${actor.name}. Reason: ${note}`,
      link: "/attendance",
      priority: "high",
    });
    return null;
  }, "Correction rejected");
}

/* ------------------------------------------------------------------ */
/* Manual entry (attendance.manage)                                    */
/* ------------------------------------------------------------------ */

const manualSchema = z.object({
  userId: zs.id("Person"),
  date: zs.date("Date"),
  checkIn: zs.time("Check-in"),
  checkOut: zs.optTime(),
  reason: zs.text("Reason", 1000),
});

export async function saveManualAttendance(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await actionPermission("attendance.manage");
    const data = parse(manualSchema, input);
    const now = new Date();
    if (data.date > todayKey()) throw new ActionError("Attendance can't be recorded for a future date.", { date: "Pick today or an earlier date" });

    const person = await User.findById(data.userId, { name: 1, employeeId: 1, personType: 1 }).lean();
    if (!person || !STAFF_TYPES.includes(person.personType)) throw new ActionError("Select a staff member.", { userId: "Select a staff member" });
    if (person._id.toString() === actor.id) throw new ActionError("You can't record your own attendance manually. Ask another administrator, or request a correction.", { userId: "Not yourself" });

    const checkIn = zonedDateTime(data.date, data.checkIn);
    const checkOut = data.checkOut ? zonedDateTime(data.date, data.checkOut) : undefined;
    if (checkIn.getTime() > now.getTime()) throw new ActionError("The check-in time can't be in the future.", { checkIn: "In the future" });
    if (checkOut && checkOut.getTime() > now.getTime()) throw new ActionError("The check-out time can't be in the future.", { checkOut: "In the future" });
    assertTimesConsistent(checkIn, checkOut);

    let att = await Attendance.findOne({ user: person._id, date: data.date });
    const before = { checkIn: att?.checkIn, checkOut: att?.checkOut };
    if (!att) att = new Attendance({ user: person._id, date: data.date, history: [] });
    att.checkIn = checkIn;
    att.checkOut = checkOut;
    att.source = "manual";
    att.remarks = data.reason;
    if (checkOut) {
      for (const b of att.breaks) if (!b.end) b.end = checkOut;
    }
    att.history.push(historyEntry(actor, "manual_entry", data.reason, span(before.checkIn, before.checkOut), span(checkIn, checkOut)));
    try {
      await att.save();
    } catch (error) {
      if (isDuplicateKey(error)) throw new ActionError("This day was just created by someone else. Reload and try again.");
      throw error;
    }
    await recalcAttendanceDay(person._id, data.date);

    await audit(actor, {
      action: "correct",
      entity: "attendance",
      entityId: att._id,
      ref: `${person.employeeId} ${data.date}`,
      summary: `Manual attendance entry for ${person.name} on ${fmtDate(data.date)}: ${data.reason}`,
      changes: diff(before, { checkIn, checkOut }, ["checkIn", "checkOut"]),
    });
    await notify(
      [person._id],
      { type: "attendance", title: "Attendance updated", body: `${actor.name} recorded your attendance for ${fmtDate(data.date)} (${span(checkIn, checkOut)}). Reason: ${data.reason}`.slice(0, 500), link: "/attendance" },
      [actor._id],
    );
    return { id: att._id.toString() };
  }, "Attendance saved");
}
