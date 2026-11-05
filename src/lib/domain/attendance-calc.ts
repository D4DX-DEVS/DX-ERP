import "server-only";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { Attendance, Holiday, LeaveRequest, Movement, type IAttendance } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { runBatch } from "@/lib/domain/batch";
import { getSettings } from "@/lib/settings";
import { inList } from "@/lib/sql";
import { hmToMinutes, isWorkingWeekday, minutesBetween, zonedDateTime } from "@/lib/time";

export interface AttendanceMetrics {
  breakMinutes: number;
  movementMinutes: number;
  workMinutes: number;
  late: boolean;
  lateMinutes: number;
  earlyDeparture: boolean;
  earlyMinutes: number;
  status: IAttendance["status"];
  missingCheckout: boolean;
}

/**
 * Pure attendance calculation (FRS §7.1–7.2, §8.11):
 * - work = (check-out − check-in) − closed breaks − (personal movement time, if policy deducts it)
 * - late when check-in is after office start + grace; early departure when check-out is before office end − grace;
 *   neither once the closed day's work reaches its target (flexible hours)
 * - full day ≥ fullDayMinutes, half day ≥ halfDayMinutes, otherwise absent (only once checked out)
 * - a temporary movement never ends the working day
 */
export function computeAttendance(
  input: {
    date: string;
    checkIn?: Date | null;
    checkOut?: Date | null;
    breaks?: { start: Date; end?: Date | null }[];
    personalMovementMinutes?: number;
    officialMovementMinutes?: number;
    onLeave?: "full" | "half" | null;
    isHoliday?: boolean;
  },
  settings: AppSettings,
  now = new Date(),
): AttendanceMetrics {
  const a = settings.attendance;
  const breakMinutes = (input.breaks ?? []).reduce((sum, b) => sum + (b.end ? minutesBetween(b.start, b.end) : 0), 0);
  const personal = input.personalMovementMinutes ?? 0;
  const official = input.officialMovementMinutes ?? 0;
  const movementMinutes = personal + official;

  let workMinutes = 0;
  if (input.checkIn && input.checkOut) {
    workMinutes = minutesBetween(input.checkIn, input.checkOut) - breakMinutes;
    if (a.personalMovementDeducted) workMinutes -= personal;
    if (!a.officialMovementCountsAsWork) workMinutes -= official;
    workMinutes = Math.max(0, workMinutes);
  }

  // Flexible hours: a closed day that reaches its target (full day, or half day on half-day leave) is neither late nor early.
  const hoursMet = Boolean(input.checkOut) && workMinutes >= (input.onLeave === "half" ? a.halfDayMinutes : a.fullDayMinutes);
  const start = zonedDateTime(input.date, a.officeStart);
  const end = zonedDateTime(input.date, a.officeEnd);
  const late = !hoursMet && Boolean(input.checkIn && input.checkIn.getTime() > start.getTime() + a.graceMinutes * 60_000);
  const lateMinutes = late && input.checkIn ? Math.max(0, minutesBetween(start, input.checkIn) - a.graceMinutes) : 0;
  const earlyDeparture = !hoursMet && Boolean(input.checkOut && input.checkOut.getTime() < end.getTime() - a.earlyLeaveGraceMinutes * 60_000);
  const earlyMinutes = earlyDeparture && input.checkOut ? Math.max(0, Math.round((end.getTime() - input.checkOut.getTime()) / 60_000) - a.earlyLeaveGraceMinutes) : 0;

  const cutoff = zonedDateTime(input.date, a.missingCheckoutAfter);
  const missingCheckout = Boolean(input.checkIn && !input.checkOut && now.getTime() > cutoff.getTime());

  const workingWeekday = isWorkingWeekday(input.date, a);
  let status: IAttendance["status"];
  if (input.onLeave === "full") status = "on_leave";
  else if (!input.checkIn) status = input.isHoliday ? "holiday" : !workingWeekday ? "weekend" : "absent";
  else if (!input.checkOut) status = "present";
  else if (workMinutes >= a.fullDayMinutes || (input.onLeave === "half" && workMinutes >= a.halfDayMinutes)) status = input.onLeave === "half" ? "half_day" : "present";
  else if (workMinutes >= a.halfDayMinutes) status = "half_day";
  else status = "absent";

  return { breakMinutes, movementMinutes, workMinutes, late, lateMinutes, earlyDeparture, earlyMinutes, status, missingCheckout };
}

/** Sum of closed movement minutes for a person on a day, split into personal / official. */
export async function movementMinutesFor(userId: string, date: string): Promise<{ personal: number; official: number }> {
  const rows = await db()
    .select({ durationMinutes: Movement.durationMinutes, official: Movement.official })
    .from(Movement)
    .where(and(eq(Movement.user, userId), eq(Movement.date, date), eq(Movement.status, "returned"), ne(Movement.approvalStatus, "rejected")));
  return rows.reduce(
    (acc, m) => {
      if (m.official) acc.official += m.durationMinutes ?? 0;
      else acc.personal += m.durationMinutes ?? 0;
      return acc;
    },
    { personal: 0, official: 0 },
  );
}

/**
 * Recomputes and saves the derived fields of several attendance days of one person in a fixed number of
 * queries (days without an attendance row are skipped). Call after any change to the days' check-in/out,
 * breaks, movements or leave.
 */
export async function recalcAttendanceDays(userId: string, dates: string[]): Promise<void> {
  const days = [...new Set(dates)].sort();
  if (days.length === 0) return;
  const rows = await db()
    .select()
    .from(Attendance)
    .where(and(eq(Attendance.user, userId), inList(Attendance.date, days)));
  if (rows.length === 0) return;
  const settings = await getSettings();
  const first = days[0];
  const last = days[days.length - 1];
  const [movements, leaves, holidays] = await Promise.all([
    db()
      .select({ date: Movement.date, durationMinutes: Movement.durationMinutes, official: Movement.official })
      .from(Movement)
      .where(and(eq(Movement.user, userId), inList(Movement.date, days), eq(Movement.status, "returned"), ne(Movement.approvalStatus, "rejected"))),
    db()
      .select({ startDate: LeaveRequest.startDate, endDate: LeaveRequest.endDate, halfDay: LeaveRequest.halfDay })
      .from(LeaveRequest)
      .where(and(eq(LeaveRequest.user, userId), eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, last), gte(LeaveRequest.endDate, first))),
    db()
      .select({ date: Holiday.date })
      .from(Holiday)
      .where(and(inList(Holiday.date, days), eq(Holiday.optional, false))),
  ]);
  const holidayDays = new Set(holidays.map((h) => h.date));
  const updates = rows.map((att) => {
    const moves = { personal: 0, official: 0 };
    for (const m of movements) {
      if (m.date !== att.date) continue;
      if (m.official) moves.official += m.durationMinutes ?? 0;
      else moves.personal += m.durationMinutes ?? 0;
    }
    const leave = leaves.find((l) => l.startDate <= att.date && l.endDate >= att.date);
    const m = computeAttendance(
      {
        date: att.date,
        checkIn: att.checkIn,
        checkOut: att.checkOut,
        breaks: att.breaks,
        personalMovementMinutes: moves.personal,
        officialMovementMinutes: moves.official,
        onLeave: leave ? (leave.halfDay ? "half" : "full") : null,
        isHoliday: holidayDays.has(att.date),
      },
      settings,
    );
    return db().update(Attendance).set(m).where(eq(Attendance._id, att._id));
  });
  await runBatch(updates);
}

/**
 * Recomputes and saves the derived fields of one attendance day. Call after any change to the
 * day's check-in/out, breaks, movements or leave.
 */
export async function recalcAttendanceDay(userId: string, date: string): Promise<void> {
  await recalcAttendanceDays(userId, [date]);
}

/** Minutes of the office day (used for progress bars / expected check-out). */
export function officeDayMinutes(settings: AppSettings): number {
  return hmToMinutes(settings.attendance.officeEnd) - hmToMinutes(settings.attendance.officeStart);
}
