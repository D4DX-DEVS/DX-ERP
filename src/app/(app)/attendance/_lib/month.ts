import "server-only";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { workCalendar } from "@/lib/domain/calendar";
import { Attendance, LeaveRequest, Movement, type IAttendance } from "@/lib/models";
import { inList } from "@/lib/sql";
import { eachDay, monthRange } from "@/lib/time";
import { classifyDay, provisionalWork, summarizeDays, type DayClass, type DaySummary } from "./day";
import { buildLeaveDayMap } from "./leave-days";

export interface LogMovement {
  id: string;
  no: string;
  minutes: number;
  official: boolean;
  open: boolean;
}

export type LogAttendance = Pick<
  IAttendance,
  "date" | "checkIn" | "checkOut" | "breaks" | "breakMinutes" | "workMinutes" | "status" | "late" | "lateMinutes" | "earlyDeparture" | "earlyMinutes"
>;

export interface LogDay {
  date: string;
  att?: LogAttendance;
  cls: DayClass;
  holidayName?: string;
  leaveLabel?: string;
  moves: LogMovement[];
  worked: number | null;
}

export interface MonthLog {
  from: string;
  to: string;
  days: LogDay[];
  /** Days up to today (or the whole month when it is over). */
  elapsed: LogDay[];
  stats: DaySummary;
}

/**
 * One person's attendance month: every day classified (present / late / leave / holiday / absent …) with worked
 * minutes and movements. Four queries, whatever the month length. Shared by My attendance and the staff profile.
 */
export async function loadMonthLog(userId: string, month: string, settings: AppSettings, today: string, now: Date): Promise<MonthLog> {
  const { from, to } = monthRange(month);
  const last = to < today ? to : today;
  const [records, movements, leaves, cal] = await Promise.all([
    db()
      .select({
        date: Attendance.date,
        checkIn: Attendance.checkIn,
        checkOut: Attendance.checkOut,
        breaks: Attendance.breaks,
        breakMinutes: Attendance.breakMinutes,
        workMinutes: Attendance.workMinutes,
        status: Attendance.status,
        late: Attendance.late,
        lateMinutes: Attendance.lateMinutes,
        earlyDeparture: Attendance.earlyDeparture,
        earlyMinutes: Attendance.earlyMinutes,
      })
      .from(Attendance)
      .where(and(eq(Attendance.user, userId), gte(Attendance.date, from), lte(Attendance.date, to))),
    db()
      .select({
        _id: Movement._id,
        movementNo: Movement.movementNo,
        date: Movement.date,
        status: Movement.status,
        durationMinutes: Movement.durationMinutes,
        official: Movement.official,
        outTime: Movement.outTime,
      })
      .from(Movement)
      .where(and(eq(Movement.user, userId), gte(Movement.date, from), lte(Movement.date, to), inList(Movement.status, ["out", "returned"]), ne(Movement.approvalStatus, "rejected"))),
    db()
      .select({
        _id: LeaveRequest._id,
        user: LeaveRequest.user,
        startDate: LeaveRequest.startDate,
        endDate: LeaveRequest.endDate,
        halfDay: LeaveRequest.halfDay,
        leaveTypeName: LeaveRequest.leaveTypeName,
      })
      .from(LeaveRequest)
      .where(and(eq(LeaveRequest.user, userId), eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, to), gte(LeaveRequest.endDate, from))),
    workCalendar(settings, from, to),
  ]);

  const leaveMap = buildLeaveDayMap(leaves, settings, cal, from, to).get(userId);
  const recByDate = new Map(records.map((r) => [r.date, r]));
  const movesByDate = new Map<string, typeof movements>();
  for (const m of movements) movesByDate.set(m.date, [...(movesByDate.get(m.date) ?? []), m]);

  const days: LogDay[] = eachDay(from, to).map((date) => {
    const att = recByDate.get(date);
    const l = leaveMap?.get(date);
    const cls = classifyDay({ date, today, now, att, leave: l ? (l.half ? "half" : "full") : null, holiday: cal.isHoliday(date), settings });
    const dayMoves = movesByDate.get(date) ?? [];
    let worked: number | null = null;
    if (att?.checkIn) {
      if (att.checkOut) worked = att.workMinutes;
      else if (date === today && cls.key === "in_progress") worked = provisionalWork({ date, checkIn: att.checkIn, checkOut: null, breaks: att.breaks }, dayMoves, settings, now);
    }
    return {
      date,
      att,
      cls,
      holidayName: cal.holidays.get(date),
      leaveLabel: l?.typeName,
      worked,
      moves: dayMoves.map((m) => ({ id: m._id, no: m.movementNo, minutes: m.durationMinutes ?? 0, official: m.official, open: m.status === "out" })),
    };
  });
  const elapsed = days.filter((d) => d.date <= last);
  return { from, to, days, elapsed, stats: summarizeDays(elapsed.map((d) => ({ key: d.cls.key, att: d.att }))) };
}
