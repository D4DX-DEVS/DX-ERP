import { addDays, dateKey, diffDays, endOfDay, fmtDate, fmtTime, todayKey } from "@/lib/time";

/**
 * Time-dependent helpers kept out of components (React purity lint): pages call these instead of
 * reading the clock themselves.
 */
export function isPast(value: Date | string | number | null | undefined): boolean {
  return value != null && new Date(value).getTime() < Date.now();
}

/** "today" as a day key. */
export function today(): string {
  return todayKey();
}

export function endOfToday(): Date {
  return endOfDay(todayKey());
}

export function inDays(n: number): string {
  return addDays(todayKey(), n);
}

/** Whole days from today until the given day key (negative when already past). */
export function daysUntil(day: string | null | undefined): number | null {
  return day ? diffDays(todayKey(), day) : null;
}

/** Compact age such as "3d", "5w", "4mo". */
export function ageLabel(created: Date | string | null | undefined): string {
  if (!created) return "—";
  const days = Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000));
  if (days < 1) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/** Short follow-up label for cards and tables: "Overdue · 19 Oct", "Today 13:00", "Tomorrow 11:00", "Thu 22 Oct". */
export function followUpView(value: Date | string | null | undefined): { label: string; overdue: boolean } | undefined {
  if (!value) return undefined;
  if (isPast(value)) return { label: `Overdue · ${fmtDate(value, "d MMM")}`, overdue: true };
  const day = dateKey(value);
  const t = todayKey();
  if (day === t) return { label: `Today ${fmtTime(value)}`, overdue: false };
  if (day === addDays(t, 1)) return { label: `Tomorrow ${fmtTime(value)}`, overdue: false };
  return { label: fmtDate(value, "EEE d MMM"), overdue: false };
}

/** True for a contract end date that is today or within `windowDays` days. */
export function endsWithin(endDate: string | null | undefined, windowDays: number): boolean {
  const left = daysUntil(endDate);
  return left !== null && left >= 0 && left <= windowDays;
}
