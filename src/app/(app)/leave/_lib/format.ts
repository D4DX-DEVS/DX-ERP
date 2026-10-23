import { fmtDate } from "@/lib/time";

/** "Thu 5 Nov 2026", "Mon 26 – Tue 27 Oct 2026", "Thu 29 Oct 2026 · 2nd half". */
export function leaveRangeLabel(r: { startDate: string; endDate: string; halfDay?: boolean; halfDaySession?: string }): string {
  if (r.startDate === r.endDate) {
    const base = fmtDate(r.startDate, "EEE d MMM yyyy");
    return r.halfDay ? `${base} · ${r.halfDaySession === "second" ? "2nd" : "1st"} half` : base;
  }
  const sameMonth = r.startDate.slice(0, 7) === r.endDate.slice(0, 7);
  return `${fmtDate(r.startDate, sameMonth ? "EEE d" : "EEE d MMM")} – ${fmtDate(r.endDate, "EEE d MMM yyyy")}`;
}

export function daysLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}
