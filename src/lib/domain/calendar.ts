import "server-only";
import { connectDB } from "@/lib/db";
import { Holiday } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { eachDay, weekday } from "@/lib/time";

export interface WorkCalendar {
  /** Mandatory (non-optional) holidays in range, keyed by day. */
  holidays: Map<string, string>;
  workingDays: Set<number>;
  isHoliday(day: string): boolean;
  isWeekend(day: string): boolean;
  isWorkingDay(day: string): boolean;
  /** Working days in [from, to] (inclusive). */
  workingDaysBetween(from: string, to: string): string[];
}

/** Loads holidays for a date range and returns working-day helpers (FRS §7.2 configurable calendar). */
export async function workCalendar(settings: AppSettings, from: string, to: string): Promise<WorkCalendar> {
  await connectDB();
  const rows = await Holiday.find({ date: { $gte: from, $lte: to }, optional: false }, { date: 1, name: 1 }).lean();
  const holidays = new Map(rows.map((h) => [h.date, h.name]));
  const workingDays = new Set(settings.attendance.workingDays);
  const cal: WorkCalendar = {
    holidays,
    workingDays,
    isHoliday: (day) => holidays.has(day),
    isWeekend: (day) => !workingDays.has(weekday(day)),
    isWorkingDay: (day) => workingDays.has(weekday(day)) && !holidays.has(day),
    workingDaysBetween: (a, b) => eachDay(a, b).filter((d) => cal.isWorkingDay(d)),
  };
  return cal;
}
