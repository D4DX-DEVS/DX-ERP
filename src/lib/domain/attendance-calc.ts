import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Attendance, Holiday, LeaveRequest, Movement, type IAttendance } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { getSettings } from "@/lib/settings";
import { hmToMinutes, minutesBetween, weekday, zonedDateTime } from "@/lib/time";

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
 * - late when check-in is after office start + grace; early departure when check-out is before office end − grace
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

  const start = zonedDateTime(input.date, a.officeStart);
  const end = zonedDateTime(input.date, a.officeEnd);
  const lateMinutes = input.checkIn ? Math.max(0, minutesBetween(start, input.checkIn) - a.graceMinutes) : 0;
  const late = Boolean(input.checkIn && input.checkIn.getTime() > start.getTime() + a.graceMinutes * 60_000);
  const earlyMinutes = input.checkOut ? Math.max(0, Math.round((end.getTime() - input.checkOut.getTime()) / 60_000) - a.earlyLeaveGraceMinutes) : 0;
  const earlyDeparture = Boolean(input.checkOut && input.checkOut.getTime() < end.getTime() - a.earlyLeaveGraceMinutes * 60_000);

  const cutoff = zonedDateTime(input.date, a.missingCheckoutAfter);
  const missingCheckout = Boolean(input.checkIn && !input.checkOut && now.getTime() > cutoff.getTime());

  const isWorkingWeekday = a.workingDays.includes(weekday(input.date));
  let status: IAttendance["status"];
  if (input.onLeave === "full") status = "on_leave";
  else if (!input.checkIn) status = input.isHoliday ? "holiday" : !isWorkingWeekday ? "weekend" : "absent";
  else if (!input.checkOut) status = "present";
  else if (workMinutes >= a.fullDayMinutes || (input.onLeave === "half" && workMinutes >= a.halfDayMinutes)) status = input.onLeave === "half" ? "half_day" : "present";
  else if (workMinutes >= a.halfDayMinutes) status = "half_day";
  else status = "absent";

  return { breakMinutes, movementMinutes, workMinutes, late, lateMinutes, earlyDeparture, earlyMinutes, status, missingCheckout };
}

/** Sum of closed movement minutes for a person on a day, split into personal / official. */
export async function movementMinutesFor(userId: string | Types.ObjectId, date: string): Promise<{ personal: number; official: number }> {
  await connectDB();
  const rows = await Movement.find({ user: userId, date, status: "returned", approvalStatus: { $ne: "rejected" } }, { durationMinutes: 1, official: 1 }).lean();
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
 * Recomputes and saves the derived fields of one attendance day. Call after any change to the
 * day's check-in/out, breaks, movements or leave.
 */
export async function recalcAttendanceDay(userId: string | Types.ObjectId, date: string): Promise<void> {
  await connectDB();
  const att = await Attendance.findOne({ user: userId, date });
  if (!att) return;
  const settings = await getSettings();
  const [moves, leave, holiday] = await Promise.all([
    movementMinutesFor(userId, date),
    LeaveRequest.findOne({ user: userId, status: "approved", startDate: { $lte: date }, endDate: { $gte: date } }, { halfDay: 1 }).lean(),
    Holiday.exists({ date, optional: false }),
  ]);
  const m = computeAttendance(
    {
      date,
      checkIn: att.checkIn,
      checkOut: att.checkOut,
      breaks: att.breaks,
      personalMovementMinutes: moves.personal,
      officialMovementMinutes: moves.official,
      onLeave: leave ? (leave.halfDay ? "half" : "full") : null,
      isHoliday: Boolean(holiday),
    },
    settings,
  );
  Object.assign(att, m);
  await att.save();
}

/** Minutes of the office day (used for progress bars / expected check-out). */
export function officeDayMinutes(settings: AppSettings): number {
  return hmToMinutes(settings.attendance.officeEnd) - hmToMinutes(settings.attendance.officeStart);
}
