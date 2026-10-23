import "server-only";
import type { Types } from "mongoose";
import type { AppSettings } from "@/lib/config-defaults";
import type { WorkCalendar } from "@/lib/domain/calendar";
import { eachDay } from "@/lib/time";

/** Days of [start, end] that count as leave days: working days, or every day when weekends count (settings.leave). */
export function leaveDaysIn(settings: AppSettings, cal: WorkCalendar, start: string, end: string): string[] {
  return settings.leave.countWeekendsInLeave ? eachDay(start, end) : cal.workingDaysBetween(start, end);
}

export interface LeaveDayInfo {
  half: boolean;
  typeName: string;
  endDate: string;
  requestId: string;
}

/** user id → day → leave info, restricted to [from, to] and to days that count as leave days. */
export type LeaveDayMap = Map<string, Map<string, LeaveDayInfo>>;

export function buildLeaveDayMap(
  requests: { _id: Types.ObjectId; user: Types.ObjectId; startDate: string; endDate: string; halfDay: boolean; leaveTypeName?: string }[],
  settings: AppSettings,
  cal: WorkCalendar,
  from: string,
  to: string,
): LeaveDayMap {
  const map: LeaveDayMap = new Map();
  for (const r of requests) {
    const start = r.startDate > from ? r.startDate : from;
    const end = r.endDate < to ? r.endDate : to;
    if (start > end) continue;
    const key = r.user.toString();
    const perUser = map.get(key) ?? new Map<string, LeaveDayInfo>();
    for (const day of leaveDaysIn(settings, cal, start, end)) {
      perUser.set(day, { half: r.halfDay, typeName: r.leaveTypeName ?? "Leave", endDate: r.endDate, requestId: r._id.toString() });
    }
    map.set(key, perUser);
  }
  return map;
}
