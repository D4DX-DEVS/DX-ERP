import "server-only";
import { workCalendar } from "@/lib/domain/calendar";
import type { AppSettings } from "@/lib/config-defaults";
import { leaveDaysIn } from "../../attendance/_lib/leave-days";

/** Days of [start, end] that count as leave days (working days, or every day when weekends count). */
export async function leaveDayList(settings: AppSettings, start: string, end: string): Promise<string[]> {
  const cal = await workCalendar(settings, start, end);
  return leaveDaysIn(settings, cal, start, end);
}
