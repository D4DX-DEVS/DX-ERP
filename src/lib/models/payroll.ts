import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { date, json, num, pk, ref, text, timestamps, type HistoryEntry, type Id } from "./_base";

export type PayrollKind = "salary" | "stipend";
/** draft → verified (HR checked attendance/leave) → approved (management) → paid (finance). */
export type PayrollRunStatus = "draft" | "verified" | "approved" | "paid" | "cancelled";

export interface PayrollTotals {
  count: number;
  gross: number;
  deductions: number;
  net: number;
}

export const PayrollRun = sqliteTable(
  "payrollruns",
  {
    _id: pk(),
    runNo: text().notNull(),
    period: text().notNull(),
    kind: text().$type<PayrollKind>().notNull(),
    status: text().$type<PayrollRunStatus>().notNull().default("draft"),
    workingDays: num().notNull().default(0),
    notes: text(),
    totals: json<PayrollTotals>()
      .notNull()
      .$defaultFn(() => ({ count: 0, gross: 0, deductions: 0, net: 0 })),
    /** "period:kind" while the run is active (not cancelled); unique, so two active runs for a month and kind cannot exist. */
    activeKey: text(),
    preparedBy: ref(),
    preparedByName: text(),
    verifiedBy: ref(),
    verifiedByName: text(),
    verifiedAt: date(),
    approvedBy: ref(),
    approvedByName: text(),
    approvedAt: date(),
    paidAt: date(),
    /** Everyone who edited payslip lines or recalculated the run — they may not approve or pay it (separation of duties). */
    editors: json<Id[]>()
      .notNull()
      .$defaultFn(() => []),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payrollruns_run_no").on(t.runNo),
    // NULLs are distinct in SQLite unique indexes, so cancelled runs (activeKey = NULL) never collide.
    uniqueIndex("payrollruns_active_key").on(t.activeKey),
    index("payrollruns_period_kind").on(t.period, t.kind),
    index("payrollruns_status").on(t.status),
  ],
);
export type IPayrollRun = typeof PayrollRun.$inferSelect;

export interface PayLine {
  key?: string;
  name: string;
  amount: number;
  /** "auto" lines are recalculated; "manual" lines (bonus, incentive, overtime, TDS…) are kept. */
  source: "auto" | "manual";
}

export interface PayslipSnapshot {
  name: string;
  employeeId: string;
  designation?: string;
  department?: string;
  joiningDate?: string;
  bankAccount?: string;
  ifsc?: string;
  bankName?: string;
  pan?: string;
}

export interface PayslipPayment {
  date?: string;
  method?: string;
  reference?: string;
  by?: Id;
  byName?: string;
  at?: Date;
}

export const Payslip = sqliteTable(
  "payslips",
  {
    _id: pk(),
    run: ref().notNull(),
    user: ref().notNull(),
    period: text().notNull(),
    kind: text().$type<PayrollKind>().notNull(),
    snapshot: json<PayslipSnapshot>().notNull(),
    workingDays: num().notNull().default(0),
    payableDays: num().notNull().default(0),
    lopDays: num().notNull().default(0),
    presentDays: num().notNull().default(0),
    leaveDays: num().notNull().default(0),
    basic: num().notNull().default(0),
    earnings: json<PayLine[]>()
      .notNull()
      .$defaultFn(() => []),
    deductions: json<PayLine[]>()
      .notNull()
      .$defaultFn(() => []),
    gross: num().notNull().default(0),
    totalDeductions: num().notNull().default(0),
    net: num().notNull().default(0),
    status: text().$type<"draft" | "approved" | "paid" | "on_hold">().notNull().default("draft"),
    payment: json<PayslipPayment>(),
    remarks: text(),
    advanceRecoveries: json<{ advance: Id; amount: number }[]>()
      .notNull()
      .$defaultFn(() => []),
    reimbursedExpenses: json<Id[]>()
      .notNull()
      .$defaultFn(() => []),
    /** Manual line edits with their amounts (shown only to `payroll.view` holders on the run page). */
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payslips_run_user").on(t.run, t.user),
    index("payslips_run").on(t.run),
    index("payslips_user").on(t.user),
    index("payslips_period").on(t.period),
  ],
);
export type IPayslip = typeof Payslip.$inferSelect;

export interface AdvanceRecovery {
  period: string;
  amount: number;
  payslip?: Id;
}

export const SalaryAdvance = sqliteTable(
  "salaryadvances",
  {
    _id: pk(),
    user: ref().notNull(),
    amount: num().notNull(),
    date: text().notNull(),
    reason: text(),
    monthlyRecovery: num().notNull().default(0),
    recovered: num().notNull().default(0),
    status: text().$type<"open" | "closed">().notNull().default("open"),
    recordedBy: ref(),
    recordedByName: text(),
    recoveries: json<AdvanceRecovery[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [index("salaryadvances_user").on(t.user)],
);
export type ISalaryAdvance = typeof SalaryAdvance.$inferSelect;
