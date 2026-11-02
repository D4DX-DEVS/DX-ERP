"use server";

import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { ActionError, actionPermission, actionUser, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { db } from "@/lib/db";
import { recalcAttendanceDays } from "@/lib/domain/attendance-calc";
import { runBatch } from "@/lib/domain/batch";
import { leaveBalances, leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { resolveFileRefs } from "@/lib/files";
import { Attendance, LeaveBalance, LeaveRequest, LeaveType, StoredFile, User, newId, type ILeaveRequest, type LeaveStatus } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { increment, inList, jsonPush, notInList } from "@/lib/sql";
import { statusLabel } from "@/lib/status";
import { fmtDate, todayKey } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { EXITED_STATUSES, STAFF_TYPES } from "../attendance/_lib/access";
import { leaveDayList } from "./_lib/days";
import { daysLabel, leaveRangeLabel } from "./_lib/format";
import { bulkLeaveBalances } from "./_lib/balances";

const ACTIVE_STATUSES: LeaveStatus[] = ["pending_manager", "pending_hr", "approved"];
const PENDING_STATUSES: LeaveStatus[] = ["pending_manager", "pending_hr"];

function historyEntry(user: Pick<CurrentUser, "_id" | "name">, action: string, note?: string) {
  return { _id: newId(), action, by: user._id, byName: user.name, at: new Date(), note };
}

/* ------------------------------------------------------------------ */
/* Attendance integration                                              */
/* ------------------------------------------------------------------ */

/**
 * Makes each leave day show as "on leave" in attendance (approval) or restores it (cancellation).
 * Full-day leave creates a system attendance row for days without a record; half-day leave only
 * recalculates days that already have one. Derived fields come from `recalcAttendanceDay`.
 */
async function syncLeaveAttendance(
  req: Pick<ILeaveRequest, "user" | "requestNo" | "startDate" | "endDate" | "halfDay">,
  mode: "apply" | "remove",
  actor: CurrentUser,
): Promise<void> {
  try {
    const settings = await getSettings();
    const days = await leaveDayList(settings, req.startDate, req.endDate);
    if (days.length === 0) return;
    // One batch per step (not one query per day): D1 limits the queries a request may run.
    if (mode === "apply") {
      const writes: BatchItem<"sqlite">[] = [];
      if (!req.halfDay) {
        for (const date of days) {
          writes.push(db().insert(Attendance).values({ user: req.user, date, source: "system", status: "on_leave", breaks: [] }).onConflictDoNothing());
        }
      }
      writes.push(
        db()
          .update(Attendance)
          .set({ history: jsonPush(Attendance.history, historyEntry(actor, "leave_approved", req.requestNo)) })
          .where(and(eq(Attendance.user, req.user), inList(Attendance.date, days))),
      );
      await runBatch(writes);
      await recalcAttendanceDays(req.user, days);
    } else {
      const rows = await db()
        .select({ _id: Attendance._id, date: Attendance.date, checkIn: Attendance.checkIn, checkOut: Attendance.checkOut, source: Attendance.source })
        .from(Attendance)
        .where(and(eq(Attendance.user, req.user), inList(Attendance.date, days)));
      const blank = rows.filter((a) => !a.checkIn && !a.checkOut && a.source === "system");
      const kept = rows.filter((a) => !(!a.checkIn && !a.checkOut && a.source === "system"));
      const writes: BatchItem<"sqlite">[] = [];
      if (blank.length) {
        writes.push(
          db()
            .delete(Attendance)
            .where(
              inList(
                Attendance._id,
                blank.map((a) => a._id),
              ),
            ),
        );
      }
      if (kept.length) {
        writes.push(
          db()
            .update(Attendance)
            .set({ history: jsonPush(Attendance.history, historyEntry(actor, "leave_cancelled", req.requestNo)) })
            .where(
              inList(
                Attendance._id,
                kept.map((a) => a._id),
              ),
            ),
        );
      }
      await runBatch(writes);
      await recalcAttendanceDays(
        req.user,
        kept.map((a) => a.date),
      );
    }
  } catch (error) {
    // The leave decision itself is already saved; day views are derived from approved leave, so this self-heals.
    console.error("[leave] attendance sync failed", error);
  }
}

/* ------------------------------------------------------------------ */
/* Apply / cancel (FRS §9.2, §9.3)                                     */
/* ------------------------------------------------------------------ */

const applySchema = z.object({
  leaveType: zs.id("Leave type"),
  startDate: zs.date("Start date"),
  endDate: zs.date("End date"),
  halfDay: zs.bool(),
  halfDaySession: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["first", "second"]).optional()),
  reason: zs.text("Reason", 1000),
  attachments: zs.ids(),
});

export async function applyLeave(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isStaff(user)) throw new ActionError("The super admin account has no leave of its own.");
    const data = parse(applySchema, input);
    const settings = await getSettings();
    const today = todayKey();

    if (data.endDate < data.startDate) throw new ActionError("The end date can't be before the start date.", { endDate: "Before the start date" });
    const [type] = await db().select().from(LeaveType).where(eq(LeaveType._id, data.leaveType)).limit(1);
    if (!type || !type.active || !type.applicableTo.includes(user.personType)) {
      throw new ActionError("This leave type isn't available to you.", { leaveType: "Not available" });
    }
    const year = leaveYearOf(data.startDate, settings);
    if (year !== leaveYearOf(data.endDate, settings)) {
      throw new ActionError("A request can't span two leave years. Submit one request for each year.", { endDate: "Crosses into the next leave year" });
    }

    if (data.halfDay) {
      if (!type.allowHalfDay) throw new ActionError(`${type.name} can't be taken as a half day.`, { halfDay: "Not allowed for this leave type" });
      if (data.startDate !== data.endDate) throw new ActionError("A half-day request covers a single day.", { halfDay: "Choose the same start and end date" });
      if (!data.halfDaySession) throw new ActionError("Choose which half of the day.", { halfDaySession: "Required" });
    }

    const list = await leaveDayList(settings, data.startDate, data.endDate);
    const days = data.halfDay ? (list.length ? 0.5 : 0) : list.length;
    if (days === 0) throw new ActionError("The selected dates have no working days. Weekends and holidays aren't counted.", { startDate: "No working days in this range" });

    // Overlap detection against the person's pending / approved requests.
    const overlapping = await db()
      .select({
        requestNo: LeaveRequest.requestNo,
        startDate: LeaveRequest.startDate,
        endDate: LeaveRequest.endDate,
        halfDay: LeaveRequest.halfDay,
        halfDaySession: LeaveRequest.halfDaySession,
        status: LeaveRequest.status,
      })
      .from(LeaveRequest)
      .where(and(eq(LeaveRequest.user, user._id), inList(LeaveRequest.status, ACTIVE_STATUSES), lte(LeaveRequest.startDate, data.endDate), gte(LeaveRequest.endDate, data.startDate)));
    const clash = overlapping.find(
      (r) => !(data.halfDay && r.halfDay && r.startDate === data.startDate && r.halfDaySession && r.halfDaySession !== data.halfDaySession),
    );
    if (clash) {
      throw new ActionError(
        `This overlaps ${clash.requestNo} (${statusLabel("leave", clash.status).toLowerCase()}, ${leaveRangeLabel(clash)}). Cancel it first or choose other dates.`,
        { startDate: "Overlaps an existing request" },
      );
    }

    if (!data.halfDay) {
      const [worked] = await db()
        .select({ date: Attendance.date })
        .from(Attendance)
        .where(and(eq(Attendance.user, user._id), inList(Attendance.date, list), isNotNull(Attendance.checkIn)))
        .limit(1);
      if (worked) throw new ActionError(`You have attendance recorded on ${fmtDate(worked.date)}. Leave can't be applied for a day you worked.`, { startDate: "Includes a day you worked" });
    }

    const files = await resolveFileRefs(user, data.attachments);
    if (type.requiresAttachmentAfterDays != null && days > type.requiresAttachmentAfterDays && files.length === 0) {
      throw new ActionError(`${type.name} longer than ${daysLabel(type.requiresAttachmentAfterDays)} needs a supporting document.`, { attachments: "Attach a document" });
    }

    if (!settings.leave.allowNegativeBalance) {
      const balances = await leaveBalances(user._id, user.personType, year, settings, today);
      const balance = balances.find((b) => b.leaveTypeId === type._id);
      if (balance && !balance.unlimited && days > balance.available) {
        throw new ActionError(`You have ${daysLabel(Math.max(0, balance.available))} of ${type.name} available, and this request needs ${daysLabel(days)}.`, { leaveType: "Not enough balance" });
      }
    }

    const manager = user.reportingManagerId;
    const [doc] = await db()
      .insert(LeaveRequest)
      .values({
        requestNo: await nextNumber("leave", ID_PREFIX.leave, 4),
        user: user._id,
        leaveType: type._id,
        leaveTypeName: type.name,
        startDate: data.startDate,
        endDate: data.endDate,
        halfDay: data.halfDay,
        halfDaySession: data.halfDay ? data.halfDaySession : undefined,
        days,
        reason: data.reason,
        status: manager ? "pending_manager" : "pending_hr",
        manager,
        approvals: [],
        attachments: files,
      })
      .returning();
    if (files.length) {
      // Tie the uploaded documents to the request so approvers can open them.
      await db()
        .update(StoredFile)
        .set({ entityId: doc._id })
        .where(
          and(
            inList(
              StoredFile._id,
              files.map((f) => f.file),
            ),
            eq(StoredFile.uploadedBy, user._id),
            eq(StoredFile.entityType, "leave"),
            isNull(StoredFile.entityId),
          ),
        );
    }

    const message = {
      type: "leave",
      title: `Leave request · ${user.name}`,
      body: `${type.name} · ${leaveRangeLabel(doc)} · ${daysLabel(days)}. ${data.reason}`.slice(0, 500),
      link: "/leave/approvals",
      actionable: true,
    };
    if (manager) await notify([manager], message);
    else await notifyPermission("leave.approve", message, [user._id]);

    await audit(user, { action: "submit", entity: "leave", entityId: doc._id, ref: doc.requestNo, summary: `Applied for ${type.name}, ${leaveRangeLabel(doc)} (${daysLabel(days)})` });
    return { id: doc._id };
  }, "Leave request submitted");
}

export async function cancelLeave(id: string, reason?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Request not found.");
    const [req] = await db()
      .select()
      .from(LeaveRequest)
      .where(and(eq(LeaveRequest._id, id), eq(LeaveRequest.user, user._id)))
      .limit(1);
    if (!req) throw new ActionError("Request not found.");
    const note = reason?.trim().slice(0, 500) || undefined;
    const patch = { status: "cancelled", cancelledAt: new Date(), cancelReason: note } as const;

    if (req.status === "approved") {
      if (req.startDate <= todayKey()) throw new ActionError("Leave that has already started can't be cancelled here. Ask HR to cancel it from Leave approvals.");
      const [claimed] = await db()
        .update(LeaveRequest)
        .set(patch)
        .where(and(eq(LeaveRequest._id, req._id), eq(LeaveRequest.status, "approved")))
        .returning();
      if (!claimed) throw new ActionError("This request was just changed. Reload and try again.");
      await syncLeaveAttendance(claimed, "remove", user);
    } else if (PENDING_STATUSES.includes(req.status)) {
      const [claimed] = await db()
        .update(LeaveRequest)
        .set(patch)
        .where(and(eq(LeaveRequest._id, req._id), inList(LeaveRequest.status, PENDING_STATUSES)))
        .returning();
      if (!claimed) throw new ActionError("This request has just been decided. Reload to see the outcome.");
    } else {
      throw new ActionError(`This request is already ${statusLabel("leave", req.status).toLowerCase()}.`);
    }

    const wasApproved = req.status === "approved";
    await notify([req.manager], {
      type: "leave",
      title: wasApproved ? `Approved leave cancelled · ${user.name}` : `Leave request withdrawn · ${user.name}`,
      body: `${req.leaveTypeName ?? "Leave"} · ${leaveRangeLabel(req)}`,
      link: wasApproved ? "/leave/calendar" : "/leave/approvals",
    });
    await audit(user, { action: "cancel", entity: "leave", entityId: req._id, ref: req.requestNo, summary: `Cancelled leave ${req.requestNo} (${leaveRangeLabel(req)})${note ? `: ${note}` : ""}` });
    return null;
  }, "Request cancelled");
}

/**
 * HR / management cancel an approved request on someone's behalf — also after it has started (the person can then
 * re-apply for the days actually taken). Attendance for the days is restored and the balance is freed.
 */
export async function revokeLeave(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    if (!can(actor, "leave.manage") && !can(actor, "leave.approve")) throw new ActionError("You don't have permission to cancel approved leave.");
    const note = parse(zs.text("Reason", 500), reason);
    if (!isObjectId(id)) throw new ActionError("Request not found.");
    const [req] = await db().select().from(LeaveRequest).where(eq(LeaveRequest._id, id)).limit(1);
    if (!req) throw new ActionError("Request not found.");
    if (req.user === actor._id) throw new ActionError("Cancel your own leave from My leave.");
    if (req.status !== "approved") throw new ActionError(`Only approved leave can be cancelled here; this request is ${statusLabel("leave", req.status).toLowerCase()}.`);
    const [claimed] = await db()
      .update(LeaveRequest)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: `Cancelled by ${actor.name}: ${note}`.slice(0, 500) })
      .where(and(eq(LeaveRequest._id, req._id), eq(LeaveRequest.status, "approved")))
      .returning();
    if (!claimed) throw new ActionError("This request was just changed. Reload and try again.");
    await syncLeaveAttendance(claimed, "remove", actor);
    const who = await applicantName(req.user);
    await notify([req.user], { type: "leave", title: "Approved leave cancelled", body: `${req.leaveTypeName ?? "Leave"} · ${leaveRangeLabel(req)} was cancelled by ${actor.name}. Reason: ${note}`, link: "/leave", priority: "high" }, [actor._id]);
    await audit(actor, {
      action: "cancel",
      entity: "leave",
      entityId: req._id,
      ref: req.requestNo,
      summary: `Cancelled ${who}'s approved leave ${req.requestNo} (${leaveRangeLabel(req)}): ${note}`,
      changes: [{ field: "status", from: "approved", to: "cancelled" }],
    });
    return null;
  }, "Leave cancelled");
}

/* ------------------------------------------------------------------ */
/* Decisions: manager → HR (FRS §9.2)                                  */
/* ------------------------------------------------------------------ */

/**
 * Loads a pending request the actor may decide. Nobody decides their own request. The reporting manager decides
 * the manager stage; `leave.approve` (HR / management) may decide at any pending stage.
 */
async function decidableRequest(actor: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new ActionError("Request not found.");
  const [req] = await db().select().from(LeaveRequest).where(eq(LeaveRequest._id, id)).limit(1);
  if (!req) throw new ActionError("Request not found.");
  if (!PENDING_STATUSES.includes(req.status)) throw new ActionError(`This request is already ${statusLabel("leave", req.status).toLowerCase()}.`);
  if (req.user === actor._id) throw new ActionError("You can't decide your own leave request.");
  const hr = can(actor, "leave.approve");
  // The current reporting manager decides, not the one recorded when the request was made.
  const [applicant] = await db().select({ reportingManager: User.reportingManager }).from(User).where(eq(User._id, req.user)).limit(1);
  const isManager = applicant?.reportingManager === actor.id;
  const allowed = hr || (req.status === "pending_manager" && isManager);
  if (!allowed) throw new ActionError("You don't have permission to decide this request.");
  return { req, hr };
}

async function applicantName(userId: string): Promise<string> {
  const [u] = await db().select({ name: User.name }).from(User).where(eq(User._id, userId)).limit(1);
  return u?.name ?? "the applicant";
}

export async function approveLeave(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const { req, hr } = await decidableRequest(actor, id);
    const comment = note?.trim().slice(0, 500) || undefined;
    const [type] = await db().select({ requiresHrApproval: LeaveType.requiresHrApproval }).from(LeaveType).where(eq(LeaveType._id, req.leaveType)).limit(1);
    const level = hr ? "hr" : "manager";
    // The manager's approval goes on to HR only when the type requires it; HR decisions are final.
    const next = hr || !type?.requiresHrApproval ? "approved" : "pending_hr";

    const [updated] = await db()
      .update(LeaveRequest)
      .set({
        status: next,
        approvals: jsonPush(LeaveRequest.approvals, { _id: newId(), level, by: actor._id, byName: actor.name, action: "approved", note: comment, at: new Date() }),
      })
      .where(and(eq(LeaveRequest._id, req._id), eq(LeaveRequest.status, req.status)))
      .returning();
    if (!updated) throw new ActionError("This request was just decided by someone else.");

    const who = await applicantName(req.user);
    const range = leaveRangeLabel(req);
    if (next === "approved") {
      await syncLeaveAttendance(updated, "apply", actor);
      await notify([req.user], { type: "leave", title: "Leave approved", body: `${req.leaveTypeName ?? "Leave"} · ${range} was approved by ${actor.name}.${comment ? ` Note: ${comment}` : ""}`, link: "/leave" });
    } else {
      await notify([req.user], { type: "leave", title: "Leave approved by your manager", body: `${req.leaveTypeName ?? "Leave"} · ${range} now needs HR approval.`, link: "/leave" });
      await notifyPermission(
        "leave.approve",
        { type: "leave", title: `Leave awaiting HR approval · ${who}`, body: `${req.leaveTypeName ?? "Leave"} · ${range} · ${daysLabel(req.days)}. Approved by ${actor.name}.`, link: "/leave/approvals", actionable: true },
        [req.user, actor._id],
      );
    }
    await audit(actor, {
      action: "approve",
      entity: "leave",
      entityId: req._id,
      ref: req.requestNo,
      summary: `Approved ${who}'s leave ${req.requestNo} (${range}) at ${level} level${next === "pending_hr" ? " — sent on to HR" : ""}`,
      changes: [{ field: "status", from: req.status, to: next }],
    });
    return null;
  }, "Leave approved");
}

export async function rejectLeave(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const comment = parse(zs.text("Reason", 500), reason);
    const { req, hr } = await decidableRequest(actor, id);
    const level = hr ? "hr" : "manager";
    const [updated] = await db()
      .update(LeaveRequest)
      .set({
        status: "rejected",
        approvals: jsonPush(LeaveRequest.approvals, { _id: newId(), level, by: actor._id, byName: actor.name, action: "rejected", note: comment, at: new Date() }),
      })
      .where(and(eq(LeaveRequest._id, req._id), eq(LeaveRequest.status, req.status)))
      .returning();
    if (!updated) throw new ActionError("This request was just decided by someone else.");

    const who = await applicantName(req.user);
    await notify([req.user], { type: "leave", title: "Leave rejected", body: `${req.leaveTypeName ?? "Leave"} · ${leaveRangeLabel(req)} was rejected by ${actor.name}. Reason: ${comment}`, link: "/leave", priority: "high" });
    await audit(actor, {
      action: "reject",
      entity: "leave",
      entityId: req._id,
      ref: req.requestNo,
      summary: `Rejected ${who}'s leave ${req.requestNo} (${leaveRangeLabel(req)}) at ${level} level: ${comment}`,
      changes: [{ field: "status", from: req.status, to: "rejected" }],
    });
    return null;
  }, "Leave rejected");
}

/* ------------------------------------------------------------------ */
/* Balances (leave.manage)                                             */
/* ------------------------------------------------------------------ */

const balanceTarget = {
  userId: zs.id("Person"),
  leaveType: zs.id("Leave type"),
  year: zs.num("Year", { min: 2000, max: 2100 }),
};

async function balanceSubject(userId: string, leaveTypeId: string) {
  const [[person], [type]] = await Promise.all([
    db().select({ _id: User._id, name: User.name, personType: User.personType, employeeId: User.employeeId }).from(User).where(eq(User._id, userId)).limit(1),
    db().select({ _id: LeaveType._id, name: LeaveType.name }).from(LeaveType).where(eq(LeaveType._id, leaveTypeId)).limit(1),
  ]);
  if (!person || !STAFF_TYPES.includes(person.personType)) throw new ActionError("Select a staff member.");
  if (!type) throw new ActionError("Leave type not found.");
  return { person, type };
}

const adjustSchema = z.object({ ...balanceTarget, amount: zs.num("Adjustment", { min: -365, max: 365 }), reason: zs.text("Reason", 500) });

export async function adjustLeaveBalance(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionPermission("leave.manage");
    const data = parse(adjustSchema, input);
    if (data.amount === 0) throw new ActionError("Enter a number of days other than zero.", { amount: "Can't be zero" });
    if (Math.round(data.amount * 2) / 2 !== data.amount) throw new ActionError("Use whole or half days.", { amount: "Use whole or half days" });
    const { person, type } = await balanceSubject(data.userId, data.leaveType);
    if (person._id === actor.id) throw new ActionError("You can't adjust your own leave balance. Ask another HR administrator.", { userId: "Not yourself" });

    const note = { _id: newId(), amount: data.amount, reason: data.reason, by: actor._id, byName: actor.name, at: new Date() };
    const [doc] = await db()
      .insert(LeaveBalance)
      .values({ user: person._id, leaveType: type._id, year: data.year, adjustment: data.amount, notes: [note] })
      .onConflictDoUpdate({
        target: [LeaveBalance.user, LeaveBalance.leaveType, LeaveBalance.year],
        set: { adjustment: increment(LeaveBalance.adjustment, data.amount), notes: jsonPush(LeaveBalance.notes, note) },
      })
      .returning();
    await audit(actor, {
      action: "update",
      entity: "leave_balance",
      entityId: doc?._id,
      ref: `${person.employeeId} ${type.name} ${data.year}`,
      summary: `Adjusted ${person.name}'s ${type.name} balance by ${data.amount > 0 ? "+" : ""}${data.amount} days for ${data.year}: ${data.reason}`,
      changes: [{ field: "adjustment", from: (doc?.adjustment ?? 0) - data.amount, to: doc?.adjustment }],
    });
    await notify([person._id], { type: "leave", title: "Leave balance adjusted", body: `${type.name}: ${data.amount > 0 ? "+" : ""}${data.amount} days. ${data.reason}`, link: "/leave" }, [actor._id]);
    return null;
  }, "Balance adjusted");
}

const quotaSchema = z.object({ ...balanceTarget, quota: zs.optNum({ min: 0, max: 365 }), reason: zs.text("Reason", 500) });

export async function setQuotaOverride(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionPermission("leave.manage");
    const data = parse(quotaSchema, input);
    const { person, type } = await balanceSubject(data.userId, data.leaveType);
    if (person._id === actor.id) throw new ActionError("You can't change your own leave quota. Ask another HR administrator.", { userId: "Not yourself" });
    const note = { _id: newId(), amount: data.quota ?? 0, reason: `${data.quota === undefined ? "Quota override removed" : `Quota override set to ${data.quota}`}: ${data.reason}`, by: actor._id, byName: actor.name, at: new Date() };
    const [before] = await db()
      .select({ quotaOverride: LeaveBalance.quotaOverride })
      .from(LeaveBalance)
      .where(and(eq(LeaveBalance.user, person._id), eq(LeaveBalance.leaveType, type._id), eq(LeaveBalance.year, data.year)))
      .limit(1);
    const [doc] = await db()
      .insert(LeaveBalance)
      .values({ user: person._id, leaveType: type._id, year: data.year, quotaOverride: data.quota ?? null, notes: [note] })
      .onConflictDoUpdate({
        target: [LeaveBalance.user, LeaveBalance.leaveType, LeaveBalance.year],
        set: { quotaOverride: data.quota ?? null, notes: jsonPush(LeaveBalance.notes, note) },
      })
      .returning();
    await audit(actor, {
      action: "update",
      entity: "leave_balance",
      entityId: doc?._id,
      ref: `${person.employeeId} ${type.name} ${data.year}`,
      summary: `${data.quota === undefined ? "Removed" : "Set"} ${person.name}'s ${type.name} quota override for ${data.year}: ${data.reason}`,
      changes: [{ field: "quotaOverride", from: before?.quotaOverride, to: data.quota }],
    });
    return null;
  }, "Quota saved");
}

/** Carries unused balance from leave year `year` into `year + 1` (capped per type, FRS §9.3). Safe to run again. */
export async function carryForward(year: number): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const actor = await actionPermission("leave.manage");
    const y = parse(zs.num("Year", { min: 2000, max: 2100 }), year);
    const settings = await getSettings();
    const asOf = leaveYearRange(y, settings).to;
    const carryTypes = await db()
      .select()
      .from(LeaveType)
      .where(and(eq(LeaveType.active, true), eq(LeaveType.carryForward, true)));
    if (carryTypes.length === 0) throw new ActionError("No leave type has carry-forward turned on.");

    const people = await db()
      .select({ _id: User._id, personType: User.personType })
      .from(User)
      .where(and(inList(User.personType, STAFF_TYPES), notInList(User.status, EXITED_STATUSES)));
    const { rows } = await bulkLeaveBalances(people.map((p) => ({ id: p._id, personType: p.personType })), y, settings, asOf);
    const existing = await db()
      .select({ user: LeaveBalance.user, leaveType: LeaveBalance.leaveType, carriedForward: LeaveBalance.carriedForward })
      .from(LeaveBalance)
      .where(
        and(
          eq(LeaveBalance.year, y + 1),
          inList(
            LeaveBalance.leaveType,
            carryTypes.map((t) => t._id),
          ),
        ),
      );
    const current = new Map(existing.map((b) => [`${b.user}:${b.leaveType}`, b.carriedForward]));

    const at = new Date();
    const ops: BatchItem<"sqlite">[] = [];
    for (const person of people) {
      for (const t of carryTypes) {
        const row = rows.get(person._id)?.get(t._id);
        if (!row) continue;
        const carry = Math.min(Math.max(0, row.available), t.maxCarryForward);
        const previous = current.get(`${person._id}:${t._id}`) ?? 0;
        if (carry === previous) continue;
        const note = { _id: newId(), amount: carry, reason: `Carried forward from ${y}`, by: actor._id, byName: actor.name, at };
        ops.push(
          db()
            .insert(LeaveBalance)
            .values({ user: person._id, leaveType: t._id, year: y + 1, carriedForward: carry, notes: [note] })
            .onConflictDoUpdate({
              target: [LeaveBalance.user, LeaveBalance.leaveType, LeaveBalance.year],
              set: { carriedForward: carry, notes: jsonPush(LeaveBalance.notes, note) },
            }),
        );
      }
    }
    await runBatch(ops);
    await audit(actor, { action: "update", entity: "leave_balance", ref: `${y} → ${y + 1}`, summary: `Carried leave forward from ${y} to ${y + 1}: ${ops.length} balances updated` });
    return { updated: ops.length };
  });
}
