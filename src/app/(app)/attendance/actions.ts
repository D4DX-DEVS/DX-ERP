"use server";

import { and, desc, eq, isNotNull, isNull, lt, lte, gte } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { ActionError, actionPermission, actionUser, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { recalcAttendanceDay } from "@/lib/domain/attendance-calc";
import { workCalendar } from "@/lib/domain/calendar";
import { requireKioskScan, startLanSignal } from "@/lib/domain/kiosk";
import { db } from "@/lib/db";
import { Attendance, AttendanceCorrection, LeaveRequest, Movement, User, newId, type IAttendance, type IAttendanceCorrection } from "@/lib/models";
import { managerOf, notify, usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { isUniqueViolation, jsonPush } from "@/lib/sql";
import { fmtDate, fmtTime, todayKey, zonedDateTime } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { STAFF_TYPES } from "./_lib/access";
import { leaveDaysIn } from "./_lib/leave-days";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function historyEntry(user: Pick<CurrentUser, "_id" | "name">, action: string, note?: string, from?: string, to?: string) {
  return { _id: newId(), action, by: user._id, byName: user.name, at: new Date(), note, from, to };
}

/** Signed-in staff member (the super admin account has no attendance of its own). */
async function staffUser(): Promise<CurrentUser> {
  const user = await actionUser();
  if (!isStaff(user)) throw new ActionError("The super admin account has no attendance of its own.");
  return user;
}

/** Today's (or a given) attendance row of a person, whole row. */
async function dayOf(userId: string, date: string): Promise<IAttendance | undefined> {
  const [att] = await db()
    .select()
    .from(Attendance)
    .where(and(eq(Attendance.user, userId), eq(Attendance.date, date)))
    .limit(1);
  return att;
}

/** Guarded write of a day that was read earlier: fails when the row changed in between (keeps `breaks` edits from clobbering each other). */
async function saveDay(att: IAttendance, set: SQLiteUpdateSetSource<typeof Attendance>): Promise<void> {
  const done = await db()
    .update(Attendance)
    .set(set)
    .where(and(eq(Attendance._id, att._id), eq(Attendance.updatedAt, att.updatedAt)))
    .returning({ id: Attendance._id });
  if (!done.length) throw new ActionError("This attendance record was just changed. Please try again.");
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

/**
 * `code`: the QR scanned from an office screen — required while QR check-in is on (Settings → Attendance).
 * `proof`: for the same-network rule, `{ lan, network }` (see `ScanProof` in lib/domain/kiosk).
 */
export async function checkIn(code?: unknown, proof?: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    const settings = await getSettings();
    if (!settings.attendance.allowSelfCheckIn) throw new ActionError("Self check-in is turned off. Ask HR to record your attendance.");
    const screen = await requireKioskScan(settings, code, proof, "check in", user);
    const today = todayKey();
    const [leave] = await db()
      .select({ startDate: LeaveRequest.startDate, endDate: LeaveRequest.endDate })
      .from(LeaveRequest)
      .where(and(eq(LeaveRequest.user, user._id), eq(LeaveRequest.status, "approved"), eq(LeaveRequest.halfDay, false), lte(LeaveRequest.startDate, today), gte(LeaveRequest.endDate, today)))
      .limit(1);
    // Only blocks when today is actually a leave day (weekends / holidays inside the range don't count).
    if (leave && leaveDaysIn(settings, await workCalendar(settings, today, today), today, today).length > 0) {
      throw new ActionError("You are on approved leave today. Cancel the leave first if you are working.");
    }

    // Race-safe: insert the day, and when a row already exists claim it with a guarded update
    // (only while it has no check-in and is not locked) — never read-then-write.
    const now = new Date();
    const entry = historyEntry(user, "check_in", screen ? `Scanned at ${screen}` : undefined);
    const [created] = await db()
      .insert(Attendance)
      .values({ user: user._id, date: today, checkIn: now, source: "self", history: [entry] })
      .onConflictDoNothing()
      .returning({ id: Attendance._id });
    if (!created) {
      const claimed = await db()
        .update(Attendance)
        .set({ checkIn: now, source: "self", history: jsonPush(Attendance.history, entry) })
        .where(and(eq(Attendance.user, user._id), eq(Attendance.date, today), isNull(Attendance.checkIn), eq(Attendance.locked, false)))
        .returning({ id: Attendance._id });
      if (!claimed.length) {
        const [existing] = await db()
          .select({ checkIn: Attendance.checkIn, locked: Attendance.locked })
          .from(Attendance)
          .where(and(eq(Attendance.user, user._id), eq(Attendance.date, today)))
          .limit(1);
        if (existing?.checkIn) throw new ActionError("You have already checked in today.");
        if (existing?.locked) throw new ActionError("Today's record is locked. Request a correction instead.");
        throw new ActionError("You have already checked in today.");
      }
    }
    await recalcAttendanceDay(user._id, today);
    return null;
  }, "Checked in");
}

export async function checkOut(code?: unknown, proof?: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    const screen = await requireKioskScan(await getSettings(), code, proof, "check out", user);
    const today = todayKey();
    const att = await dayOf(user._id, today);
    if (!att?.checkIn) {
      const [open] = await db()
        .select({ date: Attendance.date })
        .from(Attendance)
        .where(and(eq(Attendance.user, user._id), isNotNull(Attendance.checkIn), isNull(Attendance.checkOut), lt(Attendance.date, today)))
        .orderBy(desc(Attendance.date))
        .limit(1);
      if (open) throw new ActionError(`You haven't checked in today, and ${fmtDate(open.date)} has no check-out. Request a correction for that day.`);
      throw new ActionError("You haven't checked in today.");
    }
    if (att.checkOut) throw new ActionError("You have already checked out today.");
    if (att.locked) throw new ActionError("Today's record is locked. Request a correction instead.");

    // A temporary departure never ends the working day (FRS §8.11): return from the movement first.
    const [openMovement] = await db()
      .select({ movementNo: Movement.movementNo })
      .from(Movement)
      .where(and(eq(Movement.user, user._id), eq(Movement.status, "out")))
      .limit(1);
    if (openMovement) throw new ActionError(`You have an open movement (${openMovement.movementNo}). Record your return before checking out.`);

    const now = new Date();
    const openIdx = att.breaks.findIndex((b) => !b.end);
    const breaks = att.breaks.map((b, i) => (i === openIdx ? { ...b, end: now } : b));
    const note = [screen && `Scanned at ${screen}`, openIdx >= 0 && "Open break closed automatically"].filter(Boolean).join(" · ") || undefined;
    await saveDay(att, {
      checkOut: now,
      breaks,
      history: jsonPush(Attendance.history, historyEntry(user, "check_out", note)),
    });
    await recalcAttendanceDay(user._id, today);
    return null;
  }, "Checked out");
}

/**
 * Starts the local Wi-Fi handshake with the screen behind a scanned code: stores the phone's WebRTC offer and returns
 * a token to poll for the screen's answer on the Worker's own host.
 */
export async function startLanCheck(code: unknown, sdp: unknown, mode: unknown): Promise<ActionResult<{ id: string; token: string }>> {
  return runAction(async () => {
    const user = await staffUser();
    return startLanSignal(code, sdp, user, mode === "out" ? "check out" : "check in");
  });
}

async function openDay(user: CurrentUser) {
  const att = await dayOf(user._id, todayKey());
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
    await saveDay(att, {
      breaks: [...att.breaks, { _id: newId(), start: new Date() }],
      history: jsonPush(Attendance.history, historyEntry(user, "break_start")),
    });
    await recalcAttendanceDay(user._id, att.date);
    return null;
  }, "Break started");
}

export async function endBreak(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    const att = await openDay(user);
    const runningIdx = att.breaks.findIndex((b) => !b.end);
    if (runningIdx < 0) throw new ActionError("No break is running.");
    const end = new Date();
    await saveDay(att, {
      breaks: att.breaks.map((b, i) => (i === runningIdx ? { ...b, end } : b)),
      history: jsonPush(Attendance.history, historyEntry(user, "break_end")),
    });
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

    const att = await dayOf(user._id, data.date);
    const requestedCheckIn = data.checkIn ? zonedDateTime(data.date, data.checkIn) : undefined;
    const requestedCheckOut = data.checkOut ? zonedDateTime(data.date, data.checkOut) : undefined;
    if (requestedCheckIn && requestedCheckIn.getTime() > now.getTime()) throw new ActionError("The check-in time can't be in the future.", { checkIn: "In the future" });
    if (requestedCheckOut && requestedCheckOut.getTime() > now.getTime()) throw new ActionError("The check-out time can't be in the future.", { checkOut: "In the future" });
    assertTimesConsistent(requestedCheckIn ?? att?.checkIn, requestedCheckOut ?? att?.checkOut);

    const [pending] = await db()
      .select({ id: AttendanceCorrection._id })
      .from(AttendanceCorrection)
      .where(and(eq(AttendanceCorrection.user, user._id), eq(AttendanceCorrection.date, data.date), eq(AttendanceCorrection.status, "pending")))
      .limit(1);
    if (pending) {
      throw new ActionError("A correction for this date is already waiting for a decision.", { date: "Already pending" });
    }

    const [correction] = await db()
      .insert(AttendanceCorrection)
      .values({
        user: user._id,
        date: data.date,
        attendance: att?._id,
        requestedCheckIn,
        requestedCheckOut,
        original: { checkIn: att?.checkIn ?? undefined, checkOut: att?.checkOut ?? undefined, status: att?.status },
        reason: data.reason,
      })
      .returning();

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
    return { id: correction._id };
  }, "Correction request submitted");
}

export async function cancelCorrection(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await staffUser();
    if (!isObjectId(id)) throw new ActionError("Request not found.");
    const [res] = await db()
      .update(AttendanceCorrection)
      .set({ status: "cancelled" })
      .where(and(eq(AttendanceCorrection._id, id), eq(AttendanceCorrection.user, user._id), eq(AttendanceCorrection.status, "pending")))
      .returning();
    if (!res) throw new ActionError("This request can no longer be cancelled.");
    await audit(user, { action: "cancel", entity: "attendance_correction", entityId: res._id, ref: res.date, summary: `Cancelled the attendance correction for ${fmtDate(res.date)}` });
    return null;
  }, "Request cancelled");
}

/** Loads a pending correction the actor may decide (reporting manager of the requester, or `attendance.approve`; never their own). */
async function decidableCorrection(actor: CurrentUser, id: string): Promise<IAttendanceCorrection> {
  if (!isObjectId(id)) throw new ActionError("Request not found.");
  const [correction] = await db().select().from(AttendanceCorrection).where(eq(AttendanceCorrection._id, id)).limit(1);
  if (!correction) throw new ActionError("Request not found.");
  if (correction.status !== "pending") throw new ActionError(`This request was already ${correction.status}.`);
  if (correction.user === actor._id) throw new ActionError("You can't decide your own request.");
  if (!can(actor, "attendance.approve")) {
    const [isManager] = await db()
      .select({ id: User._id })
      .from(User)
      .where(and(eq(User._id, correction.user), eq(User.reportingManager, actor._id)))
      .limit(1);
    if (!isManager) throw new ActionError("You don't have permission to decide this request.");
  }
  return correction;
}

/** Writes the approved times onto the day (creating it when missing) and recalculates. Returns the attendance row id. */
async function applyCorrection(actor: CurrentUser, correction: IAttendanceCorrection): Promise<string> {
  const att = await dayOf(correction.user, correction.date);
  const before = { checkIn: att?.checkIn ?? undefined, checkOut: att?.checkOut ?? undefined };
  const checkIn = correction.requestedCheckIn ?? att?.checkIn ?? undefined;
  const checkOut = correction.requestedCheckOut ?? att?.checkOut ?? undefined;
  assertTimesConsistent(checkIn, checkOut);
  const entry = historyEntry(actor, "correction_approved", correction.reason, span(before.checkIn, before.checkOut), span(checkIn, checkOut));
  let id: string;
  if (att) {
    await saveDay(att, {
      checkIn: checkIn ?? null,
      checkOut: checkOut ?? null,
      source: "correction",
      ...(checkOut ? { breaks: att.breaks.map((b) => (b.end ? b : { ...b, end: checkOut })) } : {}),
      history: jsonPush(Attendance.history, entry),
    });
    id = att._id;
  } else {
    const [created] = await db()
      .insert(Attendance)
      .values({ user: correction.user, date: correction.date, checkIn, checkOut, source: "correction", history: [entry] })
      .returning({ id: Attendance._id });
    id = created.id;
  }
  await recalcAttendanceDay(correction.user, correction.date);
  return id;
}

export async function approveCorrection(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const correction = await decidableCorrection(actor, id);
    const reviewNote = note?.trim().slice(0, 1000) || undefined;
    const [claimed] = await db()
      .update(AttendanceCorrection)
      .set({ status: "approved", reviewer: actor._id, reviewerName: actor.name, reviewedAt: new Date(), reviewNote })
      .where(and(eq(AttendanceCorrection._id, correction._id), eq(AttendanceCorrection.status, "pending")))
      .returning({ id: AttendanceCorrection._id });
    if (!claimed) throw new ActionError("This request was already decided.");

    try {
      const attendanceId = await applyCorrection(actor, correction);
      await db().update(AttendanceCorrection).set({ attendance: attendanceId }).where(eq(AttendanceCorrection._id, correction._id));
    } catch (error) {
      await db()
        .update(AttendanceCorrection)
        .set({ status: "pending", reviewer: null, reviewerName: null, reviewedAt: null, reviewNote: null })
        .where(eq(AttendanceCorrection._id, correction._id));
      throw error;
    }

    const [who] = await db().select({ name: User.name, employeeId: User.employeeId }).from(User).where(eq(User._id, correction.user)).limit(1);
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
    const [claimed] = await db()
      .update(AttendanceCorrection)
      .set({ status: "rejected", reviewer: actor._id, reviewerName: actor.name, reviewedAt: new Date(), reviewNote: note })
      .where(and(eq(AttendanceCorrection._id, correction._id), eq(AttendanceCorrection.status, "pending")))
      .returning({ id: AttendanceCorrection._id });
    if (!claimed) throw new ActionError("This request was already decided.");

    const [who] = await db().select({ name: User.name, employeeId: User.employeeId }).from(User).where(eq(User._id, correction.user)).limit(1);
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

    const [person] = await db()
      .select({ _id: User._id, name: User.name, employeeId: User.employeeId, personType: User.personType })
      .from(User)
      .where(eq(User._id, data.userId))
      .limit(1);
    if (!person || !STAFF_TYPES.includes(person.personType)) throw new ActionError("Select a staff member.", { userId: "Select a staff member" });
    if (person._id === actor.id) throw new ActionError("You can't record your own attendance manually. Ask another administrator, or request a correction.", { userId: "Not yourself" });

    const checkIn = zonedDateTime(data.date, data.checkIn);
    const checkOut = data.checkOut ? zonedDateTime(data.date, data.checkOut) : undefined;
    if (checkIn.getTime() > now.getTime()) throw new ActionError("The check-in time can't be in the future.", { checkIn: "In the future" });
    if (checkOut && checkOut.getTime() > now.getTime()) throw new ActionError("The check-out time can't be in the future.", { checkOut: "In the future" });
    assertTimesConsistent(checkIn, checkOut);

    const att = await dayOf(person._id, data.date);
    const before = { checkIn: att?.checkIn ?? undefined, checkOut: att?.checkOut ?? undefined };
    const entry = historyEntry(actor, "manual_entry", data.reason, span(before.checkIn, before.checkOut), span(checkIn, checkOut));
    let attendanceId: string;
    if (att) {
      await saveDay(att, {
        checkIn,
        checkOut: checkOut ?? null,
        source: "manual",
        remarks: data.reason,
        ...(checkOut ? { breaks: att.breaks.map((b) => (b.end ? b : { ...b, end: checkOut })) } : {}),
        history: jsonPush(Attendance.history, entry),
      });
      attendanceId = att._id;
    } else {
      try {
        const [created] = await db()
          .insert(Attendance)
          .values({ user: person._id, date: data.date, checkIn, checkOut, source: "manual", remarks: data.reason, history: [entry] })
          .returning({ id: Attendance._id });
        attendanceId = created.id;
      } catch (error) {
        if (isUniqueViolation(error)) throw new ActionError("This day was just created by someone else. Reload and try again.");
        throw error;
      }
    }
    await recalcAttendanceDay(person._id, data.date);

    await audit(actor, {
      action: "correct",
      entity: "attendance",
      entityId: attendanceId,
      ref: `${person.employeeId} ${data.date}`,
      summary: `Manual attendance entry for ${person.name} on ${fmtDate(data.date)}: ${data.reason}`,
      changes: diff(before, { checkIn, checkOut }, ["checkIn", "checkOut"]),
    });
    await notify(
      [person._id],
      { type: "attendance", title: "Attendance updated", body: `${actor.name} recorded your attendance for ${fmtDate(data.date)} (${span(checkIn, checkOut)}). Reason: ${data.reason}`.slice(0, 500), link: "/attendance" },
      [actor._id],
    );
    return { id: attendanceId };
  }, "Attendance saved");
}
