import { and, eq, gte, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { recalcAttendanceDays } from "@/lib/domain/attendance-calc";
import { leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { carryForwardBalances } from "@/lib/domain/leave-carry";
import { Attendance, AttendanceCorrection, LeaveRequest, User, type LeaveStatus } from "@/lib/models";
import { usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { inList, notInList } from "@/lib/sql";
import { addDays, fmtDate, todayKey, zonedDateTime } from "@/lib/time";
import { notifyBatch, type BatchedNotification } from "./batch";
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
  const settings = await getSettings();
  const now = new Date();
  const today = todayKey();
  const cutoffPassed = now.getTime() > zonedDateTime(today, settings.attendance.missingCheckoutAfter).getTime();
  const open = await db()
    .select({ id: Attendance._id, user: Attendance.user, date: Attendance.date, missingCheckout: Attendance.missingCheckout })
    .from(Attendance)
    .where(and(isNotNull(Attendance.checkIn), isNull(Attendance.checkOut), gte(Attendance.date, addDays(today, -3)), lte(Attendance.date, cutoffPassed ? today : addDays(today, -1))));
  if (open.length === 0) return "no open days";

  const people = await db()
    .select({ id: User._id, name: User.name, reportingManager: User.reportingManager })
    .from(User)
    .where(and(inList(User._id, [...new Set(open.map((o) => o.user))]), inList(User.personType, STAFF), notInList(User.status, EXITED)));
  const byId = new Map(people.map((p) => [p.id, p]));
  let flagged = 0;
  let reminded = 0;
  const items: BatchedNotification[] = [];
  // Newly flagged days are recalculated per person in one go (a fixed number of queries per person).
  const toRecalc = new Map<string, string[]>();
  for (const att of open) {
    const person = byId.get(att.user);
    if (!person) continue;
    if (!att.missingCheckout) {
      toRecalc.set(att.user, [...(toRecalc.get(att.user) ?? []), att.date]);
      flagged += 1;
    }
    const key = `missing-checkout:${att.id}`;
    items.push({
      recipients: [person.id],
      input: {
        type: "attendance",
        title: "Missing check-out",
        body: `No check-out was recorded for ${fmtDate(att.date)}. Request a correction so your hours are counted.`,
        link: "/attendance",
        dedupeKey: key,
      },
    });
    items.push({
      recipients: [person.reportingManager],
      input: {
        type: "attendance",
        title: `Missing check-out · ${person.name}`,
        body: `${person.name} has no check-out for ${fmtDate(att.date)}.`,
        link: `/attendance/team?date=${att.date}`,
        dedupeKey: key,
      },
    });
    reminded += 1;
  }
  for (const [userId, dates] of toRecalc) await recalcAttendanceDays(userId, dates);
  await notifyBatch(items);
  return `${open.length} open days, ${flagged} newly flagged, ${reminded} reminders`;
}

/** Leave requests waiting more than 24 h for a decision → reminder to whoever must decide (once per request per day). */
async function leaveReminders(): Promise<string> {
  const today = todayKey();
  const stale = await db()
    .select({
      id: LeaveRequest._id,
      user: LeaveRequest.user,
      manager: LeaveRequest.manager,
      status: LeaveRequest.status,
      leaveTypeName: LeaveRequest.leaveTypeName,
      requestNo: LeaveRequest.requestNo,
      startDate: LeaveRequest.startDate,
      endDate: LeaveRequest.endDate,
      updatedAt: LeaveRequest.updatedAt,
    })
    .from(LeaveRequest)
    .where(and(inList(LeaveRequest.status, PENDING_LEAVE), lt(LeaveRequest.updatedAt, new Date(Date.now() - 24 * HOUR))));
  if (stale.length === 0) return "nothing waiting";

  const [hr, applicants] = await Promise.all([
    usersWithPermission("leave.approve"),
    db()
      .select({ id: User._id, name: User.name })
      .from(User)
      .where(inList(User._id, [...new Set(stale.map((r) => r.user))])),
  ]);
  const names = new Map(applicants.map((a) => [a.id, a.name]));
  // A request stuck with the manager for 3+ days also goes to HR / management, who may decide at any stage.
  const escalateBefore = Date.now() - 72 * HOUR;
  await notifyBatch(
    stale.map((r) => ({
      recipients: r.status === "pending_manager" && r.manager ? (r.updatedAt.getTime() < escalateBefore ? [r.manager, ...hr] : [r.manager]) : hr,
      exclude: [r.user],
      input: {
        type: "leave",
        title: `Leave request waiting · ${names.get(r.user) ?? "Applicant"}`,
        body: `${r.leaveTypeName ?? "Leave"} ${fmtDate(r.startDate)}${r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""} (${r.requestNo}) has been waiting ${waited(r.updatedAt)}.`,
        link: "/leave/approvals",
        priority: "high" as const,
        actionable: true,
        dedupeKey: `leave-reminder:${r.id}:${today}`,
      },
    })),
  );
  return `${stale.length} leave reminders`;
}

/** Attendance corrections waiting more than 24 h → reporting manager and `attendance.approve` users (once per request per day). */
async function correctionReminders(): Promise<string> {
  const today = todayKey();
  const stale = await db()
    .select({ id: AttendanceCorrection._id, user: AttendanceCorrection.user, date: AttendanceCorrection.date, createdAt: AttendanceCorrection.createdAt })
    .from(AttendanceCorrection)
    .where(and(eq(AttendanceCorrection.status, "pending"), lt(AttendanceCorrection.createdAt, new Date(Date.now() - 24 * HOUR))));
  if (stale.length === 0) return "nothing waiting";

  const [approvers, people] = await Promise.all([
    usersWithPermission("attendance.approve"),
    db()
      .select({ id: User._id, name: User.name, reportingManager: User.reportingManager })
      .from(User)
      .where(inList(User._id, [...new Set(stale.map((c) => c.user))])),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  await notifyBatch(
    stale.map((c) => {
      const person = byId.get(c.user);
      return {
        recipients: [person?.reportingManager, ...approvers],
        exclude: [c.user],
        input: {
          type: "attendance",
          title: `Attendance correction waiting · ${person?.name ?? "Staff member"}`,
          body: `The correction for ${fmtDate(c.date)} has been waiting ${waited(c.createdAt)}.`,
          link: "/attendance/corrections",
          actionable: true,
          dedupeKey: `correction-reminder:${c.id}:${today}`,
        },
      };
    }),
  );
  return `${stale.length} correction reminders`;
}

/**
 * New leave year: carry unused balance (types with carry-forward) over from the year just ended, so nobody depends on
 * HR pressing the button. Everything else resets by itself — balances are computed per leave year. Re-runs during the
 * first month pick up late approvals for the old year; HR's button on Leave → Balances does the same at any time.
 */
async function leaveYearRollover(): Promise<string> {
  const settings = await getSettings();
  const today = todayKey();
  const year = leaveYearOf(today, settings);
  if (today > addDays(leaveYearRange(year, settings).from, 30)) return "not the start of a leave year";
  const { updated, carryTypes } = await carryForwardBalances(year - 1, null);
  return carryTypes ? `${updated} balances carried from ${year - 1}` : "no carry-forward leave types";
}

export const timeJobs: Job[] = [
  { name: "attendance-missing-checkout", intervalMinutes: 30, run: missingCheckout },
  { name: "leave-pending-reminder", intervalMinutes: 60, run: leaveReminders },
  { name: "attendance-correction-reminder", intervalMinutes: 60, run: correctionReminders },
  { name: "leave-year-rollover", intervalMinutes: 720, run: leaveYearRollover },
];
