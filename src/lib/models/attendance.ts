import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, int, json, pk, ref, text, timestamps, type HistoryEntry, type Id } from "./_base";

export type AttendanceStatus = "present" | "half_day" | "absent" | "on_leave" | "holiday" | "weekend";

export interface BreakEntry {
  _id?: Id;
  start: Date;
  end?: Date;
}

export const Attendance = sqliteTable(
  "attendances",
  {
    _id: pk(),
    user: ref().notNull(),
    date: text().notNull(),
    checkIn: date(),
    checkOut: date(),
    breaks: json<BreakEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    breakMinutes: int().notNull().default(0),
    /** Net working minutes = (checkOut − checkIn) − breaks − deducted personal movement time (per policy). */
    workMinutes: int().notNull().default(0),
    movementMinutes: int().notNull().default(0),
    status: text().$type<AttendanceStatus>().notNull().default("present"),
    late: bool().notNull().default(false),
    lateMinutes: int().notNull().default(0),
    earlyDeparture: bool().notNull().default(false),
    earlyMinutes: int().notNull().default(0),
    missingCheckout: bool().notNull().default(false),
    source: text().$type<"self" | "manual" | "correction" | "system">().notNull().default("self"),
    remarks: text(),
    locked: bool().notNull().default(false),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [uniqueIndex("attendances_user_date").on(t.user, t.date), index("attendances_date_status").on(t.date, t.status)],
);
export type IAttendance = typeof Attendance.$inferSelect;

export interface AttendanceOriginal {
  checkIn?: Date;
  checkOut?: Date;
  status?: string;
}

export const AttendanceCorrection = sqliteTable(
  "attendancecorrections",
  {
    _id: pk(),
    user: ref().notNull(),
    date: text().notNull(),
    attendance: ref(),
    requestedCheckIn: date(),
    requestedCheckOut: date(),
    original: json<AttendanceOriginal>()
      .notNull()
      .$defaultFn(() => ({})),
    reason: text().notNull(),
    status: text().$type<"pending" | "approved" | "rejected" | "cancelled">().notNull().default("pending"),
    reviewer: ref(),
    reviewerName: text(),
    reviewedAt: date(),
    reviewNote: text(),
    ...timestamps(),
  },
  (t) => [index("attendancecorrections_user").on(t.user), index("attendancecorrections_status").on(t.status)],
);
export type IAttendanceCorrection = typeof AttendanceCorrection.$inferSelect;
