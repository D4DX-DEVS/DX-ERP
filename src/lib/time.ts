import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * All business dates (attendance days, leave days, movement dates) are calendar days in the
 * company time zone, stored as "yyyy-MM-dd" keys. Instants (check-in, Out-Time, In-Time) are
 * stored as UTC Date objects and always formatted in the company zone.
 */
export const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata";

export type DateLike = Date | string | number;

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Calendar day key ("yyyy-MM-dd") for an instant, in the company zone. */
export function dateKey(value: DateLike = new Date()): string {
  return formatInTimeZone(toDate(value), TZ, "yyyy-MM-dd");
}

export function todayKey(): string {
  return dateKey(new Date());
}

/** Month key ("yyyy-MM") for an instant, in the company zone. */
export function monthKey(value: DateLike = new Date()): string {
  return formatInTimeZone(toDate(value), TZ, "yyyy-MM");
}

/** Converts a company-zone wall time ("yyyy-MM-dd" + "HH:mm") to a UTC instant. */
export function zonedDateTime(day: string, time = "00:00"): Date {
  const [h = "00", m = "00"] = time.split(":");
  return fromZonedTime(`${day}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`, TZ);
}

/** Parses an <input type="datetime-local"> value ("yyyy-MM-ddTHH:mm") as company-zone time. */
export function parseLocalDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [day, time] = value.split("T");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = zonedDateTime(day, (time || "00:00").slice(0, 5));
  return isValidDate(d) ? d : null;
}

/** Formats an instant as an <input type="datetime-local"> value in company time. */
export function toLocalInput(value: DateLike | null | undefined): string {
  if (!value) return "";
  return formatInTimeZone(toDate(value), TZ, "yyyy-MM-dd'T'HH:mm");
}

/** Wall-clock "HH:mm" of an instant in the company zone. */
export function timeOf(value: DateLike): string {
  return formatInTimeZone(toDate(value), TZ, "HH:mm");
}

export function startOfDay(day: string): Date {
  return zonedDateTime(day, "00:00");
}

export function endOfDay(day: string): Date {
  return new Date(zonedDateTime(addDays(day, 1), "00:00").getTime() - 1);
}

/** Day-key arithmetic is done in UTC on the key itself, so it is DST- and zone-safe. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string): string {
  const wd = weekday(day);
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function minutesBetween(a: DateLike, b: DateLike): number {
  return Math.max(0, Math.round((toDate(b).getTime() - toDate(a).getTime()) / 60_000));
}

/** "2h 28m", "45m", "0m" */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatHours(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** "21 Oct 2026" */
export function fmtDate(value: DateLike | null | undefined, pattern = "d MMM yyyy"): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatInTimeZone(zonedDateTime(value, "12:00"), TZ, pattern);
  }
  const d = toDate(value);
  return isValidDate(d) ? formatInTimeZone(d, TZ, pattern) : "—";
}

/** "09:12" */
export function fmtTime(value: DateLike | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = toDate(value);
  return isValidDate(d) ? formatInTimeZone(d, TZ, "HH:mm") : "—";
}

/** "21 Oct 2026, 09:12" */
export function fmtDateTime(value: DateLike | null | undefined): string {
  if (value == null || value === "") return "—";
  const d = toDate(value);
  return isValidDate(d) ? formatInTimeZone(d, TZ, "d MMM yyyy, HH:mm") : "—";
}

/** "Wednesday, 21 October 2026" */
export function fmtLongDate(value: DateLike = new Date()): string {
  return fmtDate(value, "EEEE, d MMMM yyyy");
}

/** "3h ago", "2d ago", "just now" */
export function timeAgo(value: DateLike | null | undefined): string {
  if (!value) return "—";
  const diff = Date.now() - toDate(value).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(value);
}

export function greeting(now = new Date()): string {
  const h = Number(formatInTimeZone(now, TZ, "H"));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Parses "HH:mm" to minutes after midnight. */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
