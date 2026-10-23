"use server";

import { z } from "zod";
import type { Types } from "mongoose";
import { ActionError, actionPermission, actionUser, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { recalcAttendanceDay } from "@/lib/domain/attendance-calc";
import { leaveBalances, leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { resolveFileRefs } from "@/lib/files";
import { Attendance, LeaveBalance, LeaveRequest, LeaveType, StoredFile, User, type ILeaveRequest, type LeaveStatus } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
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
  return { action, by: user._id, byName: user.name, at: new Date(), note };
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
    for (const date of days) {
      if (mode === "apply") {
        if (!req.halfDay) {
          await Attendance.updateOne({ user: req.user, date }, { $setOnInsert: { source: "system", status: "on_leave", breaks: [] } }, { upsert: true }).catch((error: unknown) => {
            if ((error as { code?: number }).code !== 11000) throw error;
          });
        }
        await Attendance.updateOne({ user: req.user, date }, { $push: { history: historyEntry(actor, "leave_approved", req.requestNo) } });
      } else {
        const att = await Attendance.findOne({ user: req.user, date });
        if (!att) continue;
        if (!att.checkIn && !att.checkOut && att.source === "system") {
          await Attendance.deleteOne({ _id: att._id });
          continue;
        }
        att.history.push(historyEntry(actor, "leave_cancelled", req.requestNo));
        await att.save();
      }
      await recalcAttendanceDay(req.user, date);
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
    const type = await LeaveType.findById(data.leaveType).lean();
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
    const overlapping = await LeaveRequest.find(
      { user: user._id, status: { $in: ACTIVE_STATUSES }, startDate: { $lte: data.endDate }, endDate: { $gte: data.startDate } },
      { requestNo: 1, startDate: 1, endDate: 1, halfDay: 1, halfDaySession: 1, status: 1 },
    ).lean();
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
      const worked = await Attendance.findOne({ user: user._id, date: { $in: list }, checkIn: { $ne: null } }, { date: 1 }).lean();
      if (worked) throw new ActionError(`You have attendance recorded on ${fmtDate(worked.date)}. Leave can't be applied for a day you worked.`, { startDate: "Includes a day you worked" });
    }

    const files = await resolveFileRefs(user, data.attachments);
    if (type.requiresAttachmentAfterDays != null && days > type.requiresAttachmentAfterDays && files.length === 0) {
      throw new ActionError(`${type.name} longer than ${daysLabel(type.requiresAttachmentAfterDays)} needs a supporting document.`, { attachments: "Attach a document" });
    }

    if (!settings.leave.allowNegativeBalance) {
      const balances = await leaveBalances(user._id, user.personType, year, settings, today);
      const balance = balances.find((b) => b.leaveTypeId === type._id.toString());
      if (balance && !balance.unlimited && days > balance.available) {
        throw new ActionError(`You have ${daysLabel(Math.max(0, balance.available))} of ${type.name} available, and this request needs ${daysLabel(days)}.`, { leaveType: "Not enough balance" });
      }
    }

    const manager = user.reportingManagerId;
    const doc = await LeaveRequest.create({
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
    });
    if (files.length) {
      // Tie the uploaded documents to the request so approvers can open them.
      await StoredFile.updateMany({ _id: { $in: files.map((f) => f.file) }, uploadedBy: user._id, entityType: "leave", entityId: null }, { $set: { entityId: doc._id.toString() } });
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
    return { id: doc._id.toString() };
  }, "Leave request submitted");
}

export async function cancelLeave(id: string, reason?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Request not found.");
    const req = await LeaveRequest.findOne({ _id: id, user: user._id }).lean();
    if (!req) throw new ActionError("Request not found.");
    const note = reason?.trim().slice(0, 500) || undefined;
    const patch = { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: note } };

    if (req.status === "approved") {
      if (req.startDate <= todayKey()) throw new ActionError("Leave that has already started can't be cancelled here. Ask HR.");
      const claimed = await LeaveRequest.findOneAndUpdate({ _id: req._id, status: "approved" }, patch, { returnDocument: "after" }).lean();
      if (!claimed) throw new ActionError("This request was just changed. Reload and try again.");
      await syncLeaveAttendance(claimed, "remove", user);
    } else if (PENDING_STATUSES.includes(req.status)) {
      const claimed = await LeaveRequest.findOneAndUpdate({ _id: req._id, status: { $in: PENDING_STATUSES } }, patch, { returnDocument: "after" }).lean();
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

/* ------------------------------------------------------------------ */
/* Decisions: manager → HR (FRS §9.2)                                  */
/* ------------------------------------------------------------------ */

/**
 * Loads a pending request the actor may decide. Nobody decides their own request. The reporting manager decides
 * the manager stage; `leave.approve` (HR / management) may decide at any pending stage.
 */
async function decidableRequest(actor: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new ActionError("Request not found.");
  const req = await LeaveRequest.findById(id).lean();
  if (!req) throw new ActionError("Request not found.");
  if (!PENDING_STATUSES.includes(req.status)) throw new ActionError(`This request is already ${statusLabel("leave", req.status).toLowerCase()}.`);
  if (req.user.equals(actor._id)) throw new ActionError("You can't decide your own leave request.");
  const hr = can(actor, "leave.approve");
  // The current reporting manager decides, not the one recorded when the request was made.
  const applicant = await User.findById(req.user, { reportingManager: 1 }).lean();
  const isManager = applicant?.reportingManager?.toString() === actor.id;
  const allowed = hr || (req.status === "pending_manager" && isManager);
  if (!allowed) throw new ActionError("You don't have permission to decide this request.");
  return { req, hr };
}

async function applicantName(userId: Types.ObjectId): Promise<string> {
  const u = await User.findById(userId, { name: 1 }).lean();
  return u?.name ?? "the applicant";
}

export async function approveLeave(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const { req, hr } = await decidableRequest(actor, id);
    const comment = note?.trim().slice(0, 500) || undefined;
    const type = await LeaveType.findById(req.leaveType, { requiresHrApproval: 1 }).lean();
    const level = hr ? "hr" : "manager";
    // The manager's approval goes on to HR only when the type requires it; HR decisions are final.
    const next = hr || !type?.requiresHrApproval ? "approved" : "pending_hr";

    const updated = await LeaveRequest.findOneAndUpdate(
      { _id: req._id, status: req.status },
      { $set: { status: next }, $push: { approvals: { level, by: actor._id, byName: actor.name, action: "approved", note: comment, at: new Date() } } },
      { returnDocument: "after" },
    ).lean();
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
    const updated = await LeaveRequest.findOneAndUpdate(
      { _id: req._id, status: req.status },
      { $set: { status: "rejected" }, $push: { approvals: { level, by: actor._id, byName: actor.name, action: "rejected", note: comment, at: new Date() } } },
      { returnDocument: "after" },
    ).lean();
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
  const [person, type] = await Promise.all([User.findById(userId, { name: 1, personType: 1, employeeId: 1 }).lean(), LeaveType.findById(leaveTypeId, { name: 1 }).lean()]);
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
    if (person._id.toString() === actor.id) throw new ActionError("You can't adjust your own leave balance. Ask another HR administrator.", { userId: "Not yourself" });

    const doc = await LeaveBalance.findOneAndUpdate(
      { user: person._id, leaveType: type._id, year: data.year },
      { $inc: { adjustment: data.amount }, $push: { notes: { amount: data.amount, reason: data.reason, by: actor._id, byName: actor.name, at: new Date() } } },
      { upsert: true, returnDocument: "after" },
    ).lean();
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
    if (person._id.toString() === actor.id) throw new ActionError("You can't change your own leave quota. Ask another HR administrator.", { userId: "Not yourself" });
    const note = { amount: data.quota ?? 0, reason: `${data.quota === undefined ? "Quota override removed" : `Quota override set to ${data.quota}`}: ${data.reason}`, by: actor._id, byName: actor.name, at: new Date() };
    const before = await LeaveBalance.findOne({ user: person._id, leaveType: type._id, year: data.year }, { quotaOverride: 1 }).lean();
    const doc = await LeaveBalance.findOneAndUpdate(
      { user: person._id, leaveType: type._id, year: data.year },
      data.quota === undefined ? { $unset: { quotaOverride: 1 }, $push: { notes: note } } : { $set: { quotaOverride: data.quota }, $push: { notes: note } },
      { upsert: true, returnDocument: "after" },
    ).lean();
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
    const carryTypes = await LeaveType.find({ active: true, carryForward: true }).lean();
    if (carryTypes.length === 0) throw new ActionError("No leave type has carry-forward turned on.");

    const people = await User.find({ personType: { $in: STAFF_TYPES }, status: { $nin: EXITED_STATUSES } }, { personType: 1 }).lean();
    const { rows } = await bulkLeaveBalances(people.map((p) => ({ id: p._id.toString(), personType: p.personType })), y, settings, asOf);
    const existing = await LeaveBalance.find({ year: y + 1, leaveType: { $in: carryTypes.map((t) => t._id) } }, { user: 1, leaveType: 1, carriedForward: 1 }).lean();
    const current = new Map(existing.map((b) => [`${b.user.toString()}:${b.leaveType.toString()}`, b.carriedForward]));

    const at = new Date();
    const ops = [];
    for (const person of people) {
      for (const t of carryTypes) {
        const row = rows.get(person._id.toString())?.get(t._id.toString());
        if (!row) continue;
        const carry = Math.min(Math.max(0, row.available), t.maxCarryForward);
        const previous = current.get(`${person._id.toString()}:${t._id.toString()}`) ?? 0;
        if (carry === previous) continue;
        ops.push({
          updateOne: {
            filter: { user: person._id, leaveType: t._id, year: y + 1 },
            update: { $set: { carriedForward: carry }, $push: { notes: { amount: carry, reason: `Carried forward from ${y}`, by: actor._id, byName: actor.name, at } } },
            upsert: true,
          },
        });
      }
    }
    if (ops.length) await LeaveBalance.bulkWrite(ops);
    await audit(actor, { action: "update", entity: "leave_balance", ref: `${y} → ${y + 1}`, summary: `Carried leave forward from ${y} to ${y + 1}: ${ops.length} balances updated` });
    return { updated: ops.length };
  });
}
