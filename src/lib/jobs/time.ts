import { connectDB } from "@/lib/db";
import { recalcAttendanceDay } from "@/lib/domain/attendance-calc";
import { Attendance, AttendanceCorrection, LeaveRequest, User, type LeaveStatus } from "@/lib/models";
import { notify, usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addDays, fmtDate, todayKey, zonedDateTime } from "@/lib/time";
import type { Job } from "./registry";

const HOUR = 3_600_000;
const STAFF = ["employee", "trainee", "intern"] as const;
const EXITED = ["resigned", "terminated", "inactive"];
const PENDING_LEAVE: LeaveStatus[] = ["pending_manager", "pending_hr"];

function waited(since: Date): string {
  const hours = Math.floor((Date.now() - since.getTime()) / HOUR);
  return hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} hours`;
}

/**
 * Open attendance days (checked in, never checked out): flags `missingCheckout` through the shared recalculation
 * and reminds the person and their reporting manager once per day record. Covers recent days (so a missed run
 * catches up) and today once the configured cut-off has passed (FRS §7.1).
 */
async function missingCheckout(): Promise<string> {
  await connectDB();
  const settings = await getSettings();
  const now = new Date();
  const today = todayKey();
  const cutoffPassed = now.getTime() > zonedDateTime(today, settings.attendance.missingCheckoutAfter).getTime();
  const open = await Attendance.find(
    { checkIn: { $ne: null }, checkOut: null, date: { $gte: addDays(today, -3), $lte: cutoffPassed ? today : addDays(today, -1) } },
    { user: 1, date: 1, missingCheckout: 1 },
  ).lean();
  if (open.length === 0) return "no open days";

  const people = await User.find({ _id: { $in: open.map((o) => o.user) }, personType: { $in: STAFF }, status: { $nin: EXITED } }, { name: 1, reportingManager: 1 }).lean();
  const byId = new Map(people.map((p) => [p._id.toString(), p]));
  let flagged = 0;
  let reminded = 0;
  for (const att of open) {
    const person = byId.get(att.user.toString());
    if (!person) continue;
    if (!att.missingCheckout) {
      await recalcAttendanceDay(att.user, att.date);
      flagged += 1;
    }
    const key = `missing-checkout:${att._id.toString()}`;
    await notify([person._id], {
      type: "attendance",
      title: "Missing check-out",
      body: `No check-out was recorded for ${fmtDate(att.date)}. Request a correction so your hours are counted.`,
      link: "/attendance",
      dedupeKey: key,
    });
    await notify([person.reportingManager], {
      type: "attendance",
      title: `Missing check-out · ${person.name}`,
      body: `${person.name} has no check-out for ${fmtDate(att.date)}.`,
      link: `/attendance/team?date=${att.date}`,
      dedupeKey: key,
    });
    reminded += 1;
  }
  return `${open.length} open days, ${flagged} newly flagged, ${reminded} reminders`;
}

/** Leave requests waiting more than 24 h for a decision → reminder to whoever must decide (once per request per day). */
async function leaveReminders(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const stale = await LeaveRequest.find(
    { status: { $in: PENDING_LEAVE }, updatedAt: { $lt: new Date(Date.now() - 24 * HOUR) } },
    { user: 1, manager: 1, status: 1, leaveTypeName: 1, requestNo: 1, startDate: 1, endDate: 1, updatedAt: 1 },
  ).lean();
  if (stale.length === 0) return "nothing waiting";

  const [hr, applicants] = await Promise.all([usersWithPermission("leave.approve"), User.find({ _id: { $in: stale.map((r) => r.user) } }, { name: 1 }).lean()]);
  const names = new Map(applicants.map((a) => [a._id.toString(), a.name]));
  let sent = 0;
  for (const r of stale) {
    const recipients = r.status === "pending_manager" && r.manager ? [r.manager.toString()] : hr;
    await notify(
      recipients,
      {
        type: "leave",
        title: `Leave request waiting · ${names.get(r.user.toString()) ?? "Applicant"}`,
        body: `${r.leaveTypeName ?? "Leave"} ${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""} (${r.requestNo}) has been waiting ${waited(r.updatedAt)}.`,
        link: "/leave/approvals",
        priority: "high",
        actionable: true,
        dedupeKey: `leave-reminder:${r._id.toString()}:${today}`,
      },
      [r.user],
    );
    sent += 1;
  }
  return `${sent} leave reminders`;
}

/** Attendance corrections waiting more than 24 h → reporting manager and `attendance.approve` users (once per request per day). */
async function correctionReminders(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const stale = await AttendanceCorrection.find({ status: "pending", createdAt: { $lt: new Date(Date.now() - 24 * HOUR) } }, { user: 1, date: 1, createdAt: 1 }).lean();
  if (stale.length === 0) return "nothing waiting";

  const [approvers, people] = await Promise.all([usersWithPermission("attendance.approve"), User.find({ _id: { $in: stale.map((c) => c.user) } }, { name: 1, reportingManager: 1 }).lean()]);
  const byId = new Map(people.map((p) => [p._id.toString(), p]));
  let sent = 0;
  for (const c of stale) {
    const person = byId.get(c.user.toString());
    await notify(
      [person?.reportingManager, ...approvers],
      {
        type: "attendance",
        title: `Attendance correction waiting · ${person?.name ?? "Staff member"}`,
        body: `The correction for ${fmtDate(c.date)} has been waiting ${waited(c.createdAt)}.`,
        link: "/attendance/corrections",
        actionable: true,
        dedupeKey: `correction-reminder:${c._id.toString()}:${today}`,
      },
      [c.user],
    );
    sent += 1;
  }
  return `${sent} correction reminders`;
}

export const timeJobs: Job[] = [
  { name: "attendance-missing-checkout", intervalMinutes: 30, run: missingCheckout },
  { name: "leave-pending-reminder", intervalMinutes: 60, run: leaveReminders },
  { name: "attendance-correction-reminder", intervalMinutes: 60, run: correctionReminders },
];
