import { cache } from "react";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { TodayState } from "../_components/today-actions";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { Attendance, Holiday, LeaveRequest, Movement } from "@/lib/models";
import { isWorkingWeekday, todayKey } from "@/lib/time";

/**
 * Today's attendance row, open movement, approved leave and holiday for one person. Cached per request so the
 * Today card and the dashboard's check-in button share one set of queries.
 */
export const loadToday = cache(async (userId: string) => {
  const today = todayKey();
  const [[att], [openMovement], [leave], [holiday]] = await Promise.all([
    db()
      .select({
        checkIn: Attendance.checkIn,
        checkOut: Attendance.checkOut,
        breaks: Attendance.breaks,
        workMinutes: Attendance.workMinutes,
        status: Attendance.status,
        late: Attendance.late,
        lateMinutes: Attendance.lateMinutes,
        earlyDeparture: Attendance.earlyDeparture,
      })
      .from(Attendance)
      .where(and(eq(Attendance.user, userId), eq(Attendance.date, today)))
      .limit(1),
    db()
      .select({ _id: Movement._id, categoryLabel: Movement.categoryLabel, official: Movement.official, outTime: Movement.outTime })
      .from(Movement)
      .where(and(eq(Movement.user, userId), eq(Movement.status, "out")))
      .orderBy(desc(Movement.outTime))
      .limit(1),
    db()
      .select({ halfDay: LeaveRequest.halfDay })
      .from(LeaveRequest)
      .where(and(eq(LeaveRequest.user, userId), eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, today), gte(LeaveRequest.endDate, today)))
      .limit(1),
    db()
      .select({ id: Holiday._id })
      .from(Holiday)
      .where(and(eq(Holiday.date, today), eq(Holiday.optional, false)))
      .limit(1),
  ]);
  return { today, att, openMovement, leave, holiday };
});

/** What the person can do about attendance right now, and the approved leave that counts today. */
export function todayState({ today, att, leave, holiday }: Awaited<ReturnType<typeof loadToday>>, settings: AppSettings) {
  // Leave only counts on days that are leave days (working days, unless weekends count).
  const countsAsLeaveDay = settings.leave.countWeekendsInLeave || (isWorkingWeekday(today, settings.attendance) && !holiday);
  const leaveToday = leave && countsAsLeaveDay ? (leave.halfDay ? "half" : "full") : null;
  const onBreak = Boolean(att?.checkIn && !att.checkOut && att.breaks.some((b) => !b.end));

  let state: TodayState;
  let note: string | undefined;
  if (att?.checkIn) state = att.checkOut ? "done" : onBreak ? "on_break" : "working";
  else if (leaveToday === "full") {
    state = "unavailable";
    note = "You're on approved leave today.";
  } else if (!settings.attendance.allowSelfCheckIn) {
    state = "unavailable";
    note = "Self check-in is turned off. Ask HR to record your attendance.";
  } else state = "can_check_in";
  return { state, note, leaveToday } as const;
}
