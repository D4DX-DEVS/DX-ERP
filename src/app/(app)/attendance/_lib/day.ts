import "server-only";
import type { AppSettings, Tone } from "@/lib/config-defaults";
import { computeAttendance } from "@/lib/domain/attendance-calc";
import type { IAttendance } from "@/lib/models";
import { statusLabel, statusTone } from "@/lib/status";
import { minutesBetween, weekday, zonedDateTime } from "@/lib/time";

/**
 * Display status of one calendar day for one person. The stored `Attendance.status` only knows
 * present / half_day / absent / on_leave / holiday / weekend; the UI also distinguishes late,
 * early departure, missing check-out, "not checked in" and "in progress", which are derived here.
 */
export type DayKey =
  | "present"
  | "late"
  | "half_day"
  | "early"
  | "absent"
  | "on_leave"
  | "half_leave"
  | "missing_checkout"
  | "holiday"
  | "weekend"
  | "not_checked_in"
  | "in_progress"
  | "upcoming"
  | "not_tracked";

export type DayAttendance = Pick<IAttendance, "status" | "late" | "earlyDeparture"> & { checkIn?: Date | null; checkOut?: Date | null };

export interface DayInput {
  date: string;
  today: string;
  now: Date;
  att?: DayAttendance | null;
  /** Approved leave covering the day (only days that count as leave days). */
  leave?: "full" | "half" | null;
  holiday?: boolean;
  settings: AppSettings;
}

export interface DayClass {
  key: DayKey;
  /** Secondary flags shown next to the primary chip (late / early departure). */
  extras: DayKey[];
}

export function classifyDay({ date, today, now, att, leave, holiday, settings }: DayInput): DayClass {
  const a = settings.attendance;
  const none: DayKey[] = [];

  if (att?.checkIn) {
    if (att.status === "on_leave") return { key: "on_leave", extras: none };
    const flags: DayKey[] = [];
    if (att.late) flags.push("late");
    if (att.earlyDeparture) flags.push("early");
    if (!att.checkOut) {
      const cutoff = zonedDateTime(date, a.missingCheckoutAfter);
      const missing = date < today || now.getTime() > cutoff.getTime();
      return { key: missing ? "missing_checkout" : "in_progress", extras: att.late ? ["late"] : none };
    }
    if (att.status === "half_day") return { key: "half_day", extras: flags };
    if (att.status === "absent") return { key: "absent", extras: flags };
    if (att.late) return { key: "late", extras: att.earlyDeparture ? ["early"] : none };
    if (att.earlyDeparture) return { key: "early", extras: none };
    return { key: "present", extras: none };
  }

  if (att?.status === "on_leave" || leave === "full") return { key: "on_leave", extras: none };
  if (leave === "half") return { key: "half_leave", extras: none };
  if (holiday) return { key: "holiday", extras: none };
  if (!a.workingDays.includes(weekday(date))) return { key: "weekend", extras: none };
  if (date > today) return { key: "upcoming", extras: none };
  if (date === today) {
    const cutoff = zonedDateTime(today, a.missingCheckoutAfter);
    return { key: now.getTime() > cutoff.getTime() ? "absent" : "not_checked_in", extras: none };
  }
  // Before the configured go-live date a missing record is not an absence.
  if (a.trackingStartDate && date < a.trackingStartDate) return { key: "not_tracked", extras: none };
  return { key: "absent", extras: none };
}

const EXTRA_CHIPS: Partial<Record<DayKey, [string, Tone]>> = {
  in_progress: ["In progress", "blue"],
  half_leave: ["Half-day leave", "blue"],
  upcoming: ["—", "gray"],
  not_tracked: ["Before go-live", "gray"],
};

export function dayChipInfo(key: DayKey): { label: string; tone: Tone } {
  const extra = EXTRA_CHIPS[key];
  if (extra) return { label: extra[0], tone: extra[1] };
  return { label: statusLabel("attendance", key), tone: statusTone("attendance", key) };
}

/** Whether the person physically attended (had a check-in) according to the classification. */
export function isAttended(key: DayKey): boolean {
  return key === "present" || key === "late" || key === "early" || key === "in_progress" || key === "missing_checkout";
}

export interface DaySummary {
  /** Working days (not weekend / holiday) up to and including today. */
  workingDays: number;
  present: number;
  halfDays: number;
  absent: number;
  leaveDays: number;
  lateCount: number;
  earlyCount: number;
  missingCheckout: number;
  workMinutes: number;
  /** Days that contributed to `workMinutes` (closed days with hours). */
  workedDays: number;
}

export interface SummaryDay {
  key: DayKey;
  att?: Pick<IAttendance, "late" | "earlyDeparture" | "workMinutes"> & { checkIn?: Date | null; checkOut?: Date | null } | null;
}

export function summarizeDays(days: SummaryDay[]): DaySummary {
  const s: DaySummary = { workingDays: 0, present: 0, halfDays: 0, absent: 0, leaveDays: 0, lateCount: 0, earlyCount: 0, missingCheckout: 0, workMinutes: 0, workedDays: 0 };
  for (const d of days) {
    if (d.key !== "holiday" && d.key !== "weekend" && d.key !== "upcoming" && d.key !== "not_tracked") s.workingDays += 1;
    if (isAttended(d.key)) s.present += 1;
    if (d.key === "half_day") s.halfDays += 1;
    if (d.key === "absent") s.absent += 1;
    if (d.key === "on_leave") s.leaveDays += 1;
    if (d.key === "half_leave") s.leaveDays += 0.5;
    if (d.key === "missing_checkout") s.missingCheckout += 1;
    if (d.att?.checkIn && d.att.late) s.lateCount += 1;
    if (d.att?.checkOut && d.att.earlyDeparture) s.earlyCount += 1;
    if (d.att?.checkOut && d.att.workMinutes > 0) {
      s.workMinutes += d.att.workMinutes;
      s.workedDays += 1;
    }
  }
  return s;
}

export interface MovementForWork {
  official: boolean;
  durationMinutes?: number | null;
  status: string;
  outTime?: Date | null;
}

/**
 * Provisional net working minutes for a day that has a check-in but no check-out yet ("worked so far"),
 * using the same rules as `computeAttendance` with check-out = now and open breaks / movements ended now.
 */
export function provisionalWork(
  att: { date: string; checkIn: Date; checkOut?: Date | null; breaks: { start: Date; end?: Date | null }[] },
  moves: MovementForWork[],
  settings: AppSettings,
  now: Date,
): number {
  let personal = 0;
  let official = 0;
  for (const m of moves) {
    const minutes = m.status === "out" && m.outTime ? minutesBetween(m.outTime, now) : (m.durationMinutes ?? 0);
    if (m.official) official += minutes;
    else personal += minutes;
  }
  return computeAttendance(
    {
      date: att.date,
      checkIn: att.checkIn,
      checkOut: att.checkOut ?? now,
      breaks: att.breaks.map((b) => ({ start: b.start, end: b.end ?? now })),
      personalMovementMinutes: personal,
      officialMovementMinutes: official,
    },
    settings,
    now,
  ).workMinutes;
}
