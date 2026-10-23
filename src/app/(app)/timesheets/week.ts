import { addDays, fmtDate } from "@/lib/time";

/** ISO-8601 week number of a "yyyy-MM-dd" day (pure arithmetic on the key, no clock access). */
export function isoWeekNumber(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  const weekdayIndex = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekdayIndex + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstWeekdayIndex = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekdayIndex + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** "19 – 25 Oct" / "28 Sep – 4 Oct" for a Monday-start week. */
export function weekRange(monday: string): string {
  const sunday = addDays(monday, 6);
  return monday.slice(0, 7) === sunday.slice(0, 7) ? `${fmtDate(monday, "d")} – ${fmtDate(sunday, "d MMM")}` : `${fmtDate(monday, "d MMM")} – ${fmtDate(sunday, "d MMM")}`;
}

/** "Week 43 · 19 – 25 Oct" */
export function weekLabel(monday: string): string {
  return `Week ${isoWeekNumber(monday)} · ${weekRange(monday)}`;
}
