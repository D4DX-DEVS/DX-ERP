import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, int, json, num, pk, ref, text, timestamps, type FileRef, type Id } from "./_base";

/**
 * How a leave type is earned and taken. `standard`: quota accrues (pro-rated for mid-year joiners / leavers).
 * `comp_off`: no quota — credits come from approved comp-off claims (work on a weekend or holiday). `optional_holiday`:
 * a fixed number of the admin's optional holidays per year, taken only on those dates.
 */
export const LEAVE_KINDS = ["standard", "comp_off", "optional_holiday"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

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
    kind: text().$type<LeaveKind>().notNull().default("standard"),
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
    /**
     * Optional per-person entitlement for the leave year, replacing the computed (pro-rated) quota. Monthly types spread
     * it over the months the person is employed in that year.
     */
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

export type CompOffStatus = "pending" | "approved" | "rejected" | "cancelled";

/**
 * A claim for compensatory leave after working on a weekend or holiday. Approved claims are the comp-off type's credits
 * for `creditYear` (computed into balances, never copied), so cancelling or correcting a claim can't leave a stale balance.
 */
export const CompOffClaim = sqliteTable(
  "compoffclaims",
  {
    _id: pk(),
    claimNo: text().notNull(),
    user: ref().notNull(),
    /** The comp-off leave type credited. */
    leaveType: ref().notNull(),
    workDate: text().notNull(),
    /** 1 or 0.5, from the hours worked that day. */
    days: num().notNull(),
    workMinutes: int().notNull().default(0),
    reason: text().notNull(),
    status: text().$type<CompOffStatus>().notNull().default("pending"),
    manager: ref(),
    /** Leave year the credit belongs to (the work date's year, or the current one when that year has ended). */
    creditYear: int().notNull(),
    decidedBy: ref(),
    decidedByName: text(),
    decidedAt: date(),
    decisionNote: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("compoffclaims_claim_no").on(t.claimNo),
    index("compoffclaims_user").on(t.user),
    index("compoffclaims_status").on(t.status),
    index("compoffclaims_manager").on(t.manager),
  ],
);
export type ICompOffClaim = typeof CompOffClaim.$inferSelect;
