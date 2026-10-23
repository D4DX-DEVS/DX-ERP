import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, int, json, num, pk, ref, text, timestamps, type FileRef, type Id } from "./_base";

/** Writes must trim `name` and store `code` trimmed + uppercased. */
export const LeaveType = sqliteTable(
  "leavetypes",
  {
    _id: pk(),
    name: text().notNull(),
    code: text().notNull(),
    color: text(),
    annualQuota: num().notNull().default(0),
    accrual: text().$type<"upfront" | "monthly">().notNull().default("upfront"),
    carryForward: bool().notNull().default(false),
    maxCarryForward: num().notNull().default(0),
    paid: bool().notNull().default(true),
    allowHalfDay: bool().notNull().default(true),
    requiresHrApproval: bool().notNull().default(false),
    requiresAttachmentAfterDays: num(),
    applicableTo: json<string[]>()
      .notNull()
      .$defaultFn(() => ["employee", "trainee", "intern"]),
    active: bool().notNull().default(true),
    order: int().notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex("leavetypes_code").on(t.code)],
);
export type ILeaveType = typeof LeaveType.$inferSelect;

export interface LeaveBalanceNote {
  _id?: Id;
  amount: number;
  reason: string;
  by?: Id;
  byName?: string;
  at: Date;
}

/**
 * Per user / type / leave-year adjustments. "Used" and "accrued" are always computed from
 * approved requests and the type's quota, so balances never drift.
 */
export const LeaveBalance = sqliteTable(
  "leavebalances",
  {
    _id: pk(),
    user: ref().notNull(),
    leaveType: ref().notNull(),
    year: int().notNull(),
    carriedForward: num().notNull().default(0),
    adjustment: num().notNull().default(0),
    /** Optional per-person override of the annual quota (e.g. pro-rated for mid-year joiners). */
    quotaOverride: num(),
    notes: json<LeaveBalanceNote[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [uniqueIndex("leavebalances_user_type_year").on(t.user, t.leaveType, t.year)],
);
export type ILeaveBalance = typeof LeaveBalance.$inferSelect;

export type LeaveStatus = "pending_manager" | "pending_hr" | "approved" | "rejected" | "cancelled";

export interface LeaveApproval {
  _id?: Id;
  level: "manager" | "hr";
  by: Id;
  byName: string;
  action: "approved" | "rejected";
  note?: string;
  at: Date;
}

export const LeaveRequest = sqliteTable(
  "leaverequests",
  {
    _id: pk(),
    requestNo: text().notNull(),
    user: ref().notNull(),
    leaveType: ref().notNull(),
    leaveTypeName: text(),
    startDate: text().notNull(),
    endDate: text().notNull(),
    halfDay: bool().notNull().default(false),
    halfDaySession: text().$type<"first" | "second">(),
    days: num().notNull(),
    reason: text().notNull(),
    status: text().$type<LeaveStatus>().notNull().default("pending_manager"),
    manager: ref(),
    approvals: json<LeaveApproval[]>()
      .notNull()
      .$defaultFn(() => []),
    attachments: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    cancelledAt: date(),
    cancelReason: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("leaverequests_request_no").on(t.requestNo),
    index("leaverequests_user").on(t.user),
    index("leaverequests_start_date").on(t.startDate),
    index("leaverequests_end_date").on(t.endDate),
    index("leaverequests_status").on(t.status),
    index("leaverequests_manager").on(t.manager),
  ],
);
export type ILeaveRequest = typeof LeaveRequest.$inferSelect;
