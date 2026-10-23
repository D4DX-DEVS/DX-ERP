/**
 * Payroll and stipend calculation (FRS §10, §24.6) — pure functions, no database access.
 * `load.ts` gathers the inputs (people, leave, attendance, advances, expenses) and calls these.
 *
 * Rules implemented here
 * ----------------------
 * Days
 *  - Pay-basis days of the month = working days (default) or calendar days (`settings.payroll.lopBasis`).
 *  - Employment window = joining date … last working day (or internship start … end), clipped to the month.
 *    Days outside the window are unpaid.
 *  - LOP days = approved UNPAID leave days (half day = 0.5) + absent working days. A working day is absent when
 *    its attendance status is "absent", or when it has no attendance record, is in the past, and is not covered
 *    by an approved leave (holidays and weekends are never working days). Only days up to today are examined —
 *    days still to come in the month count as payable.
 *  - payable days = pay-basis days inside the window − LOP days (never below 0). On the calendar-days basis the LOP
 *    (counted on working days) is scaled to calendar days so the loss matches the divisor.
 *  - Two half-day leaves on the same day (first half + second half) cover the whole day.
 *
 * Salary payslip (kind "salary")
 *  - earned basic = basic × payable / pay-basis days of the month.
 *  - Allowances on the salary structure and fixed earning components are pro-rated the same way; percentage
 *    earning components are a percentage of the earned basic.
 *  - Reimbursements = approved, unpaid reimbursable expenses (one earning line each).
 *  - Deductions: the structure's fixed deductions, deduction components (percent of earned basic with an
 *    optional monthly cap, or a fixed amount — neither is pro-rated), then salary-advance recovery.
 *  - Advance recovery = min(monthly recovery, remaining balance) and is further limited so that it never pushes
 *    net pay below zero.
 *
 * Stipend payslip (kind "stipend")
 *  - Monthly stipend = amount × payable / pay-basis days; a one-time stipend is the full amount, paid once.
 *  - The stipend is the "basic" for any percentage component that applies to the person type.
 *
 * Totals: gross = Σ earnings, deductions = Σ deductions, net = gross − deductions, never negative
 * (`netClamped` flags the case where deductions exceed earnings).
 * Manual lines (bonus, incentive, overtime, TDS, other) are kept as-is and included in the totals.
 */
import type { AppSettings, PayrollComponent } from "@/lib/config-defaults";
import type { MoneyLine, PayLine, PayrollKind } from "@/lib/models";
import { round2 } from "@/lib/format";
import { eachDay, monthRange } from "@/lib/time";

export type PayBasis = AppSettings["payroll"]["lopBasis"];

export interface LeaveSpan {
  start: string;
  end: string;
  halfDay: boolean;
  /** false = unpaid leave type (loss of pay). */
  paid: boolean;
}

export interface Window {
  start: string;
  end: string;
}

const maxDay = (...days: (string | undefined | null)[]): string => days.filter((d): d is string => Boolean(d)).reduce((a, b) => (a > b ? a : b));
const minDay = (...days: (string | undefined | null)[]): string => days.filter((d): d is string => Boolean(d)).reduce((a, b) => (a < b ? a : b));

/** Days the person is employed in the month; null when they are not employed at any point of it. */
export function employmentWindow(period: string, opts: { joined?: string | null; left?: string | null; startDate?: string | null; endDate?: string | null }): Window | null {
  const { from, to } = monthRange(period);
  const start = maxDay(from, opts.joined, opts.startDate);
  const end = minDay(to, opts.left, opts.endDate);
  return start <= end ? { start, end } : null;
}

export interface DayCountInput {
  period: string;
  /** Company-zone calendar day of the calculation. */
  today: string;
  window: Window | null;
  basis: PayBasis;
  isWorkingDay: (day: string) => boolean;
  /** Approved leave of the person overlapping the month. */
  leaves: LeaveSpan[];
  /** Attendance status per day (only days that have a record). */
  attendance: Map<string, string>;
  /** Days before this (go-live) without an attendance record are not counted as absent. */
  trackingStartDate?: string;
}

export interface DayCounts {
  /** Pay-basis days of the whole month (the divisor of every pro-rata amount). */
  totalDays: number;
  /** Pay-basis days inside the employment window. */
  windowDays: number;
  lopDays: number;
  presentDays: number;
  leaveDays: number;
  payableDays: number;
}

export function countDays(input: DayCountInput): DayCounts {
  const { from, to } = monthRange(input.period);
  const monthDays = eachDay(from, to).filter((d) => input.basis === "calendar_days" || input.isWorkingDay(d));
  const totalDays = monthDays.length;
  const { window } = input;
  if (!window) return { totalDays, windowDays: 0, lopDays: 0, presentDays: 0, leaveDays: 0, payableDays: 0 };

  const windowDays = monthDays.filter((d) => d >= window.start && d <= window.end).length;
  const lastExamined = minDay(window.end, to, input.today);
  let lop = 0;
  let present = 0;
  let leave = 0;
  let workingInWindow = 0;
  for (const day of eachDay(window.start, window.end)) if (input.isWorkingDay(day)) workingInWindow += 1;
  if (window.start <= lastExamined) {
    for (const day of eachDay(window.start, lastExamined)) {
      if (!input.isWorkingDay(day)) continue;
      const covering = input.leaves.filter((l) => l.start <= day && day <= l.end);
      const full = covering.find((l) => !l.halfDay);
      const halves = covering.filter((l) => l.halfDay);
      const status = input.attendance.get(day);
      const tracked = !input.trackingStartDate || day >= input.trackingStartDate;
      const absent = status === "absent" || (status === undefined && day < input.today && tracked);

      if (full) {
        leave += 1;
        if (!full.paid) lop += 1;
      } else if (halves.length >= 2) {
        // A first-half and a second-half request on the same day cover the whole day.
        leave += 1;
        lop += Math.min(1, 0.5 * halves.filter((l) => !l.paid).length);
      } else if (halves.length === 1) {
        leave += 0.5;
        if (!halves[0].paid) lop += 0.5;
        // The other half of the day counts as lost pay unless the person was there.
        if (absent) lop += 0.5;
        else if (status) present += 0.5;
      } else if (absent) {
        lop += 1;
      } else if (status === "present") {
        present += 1;
      } else if (status === "half_day") {
        present += 0.5;
      } else if (status === "on_leave") {
        leave += 1;
      }
    }
  }
  // On the calendar-days basis the divisor is calendar days while LOP was counted on working days, so scale the
  // loss to calendar days: someone absent for every working day loses the whole month, one absent working day
  // costs the same as it does on the working-days basis.
  const lopRaw = input.basis === "calendar_days" && workingInWindow > 0 ? (lop * windowDays) / workingInWindow : lop;
  const payableDays = Math.max(0, round2(windowDays - lopRaw));
  return {
    totalDays,
    windowDays,
    lopDays: round2(windowDays - payableDays),
    presentDays: round2(present),
    leaveDays: round2(leave),
    payableDays,
  };
}

export interface ManualLines {
  earnings: PayLine[];
  deductions: PayLine[];
}

export interface AdvanceInput {
  id: string;
  label: string;
  monthlyRecovery: number;
  /** amount − recovered so far */
  remaining: number;
}

export interface ReimbursementInput {
  id: string;
  label: string;
  amount: number;
}

export interface PayInput {
  kind: PayrollKind;
  personType: string;
  counts: DayCounts;
  salary?: { basic: number; allowances: MoneyLine[]; deductions: MoneyLine[] };
  stipend?: { amount: number; period: "monthly" | "one_time" };
  components: PayrollComponent[];
  advances: AdvanceInput[];
  reimbursements: ReimbursementInput[];
  manual: ManualLines;
}

export interface PayResult {
  basic: number;
  earnings: PayLine[];
  deductions: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  /** true when deductions exceeded earnings and net pay was held at zero. */
  netClamped: boolean;
  advanceRecoveries: { advance: string; amount: number }[];
  reimbursedExpenses: string[];
}

const sum = (lines: PayLine[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

/** gross / deductions / net from the final lines (net never below zero). */
export function totalsOf(earnings: PayLine[], deductions: PayLine[]): { gross: number; totalDeductions: number; net: number; netClamped: boolean } {
  const gross = sum(earnings);
  const totalDeductions = sum(deductions);
  const raw = round2(gross - totalDeductions);
  return { gross, totalDeductions, net: Math.max(0, raw), netClamped: raw < 0 };
}

export const REIMBURSEMENT_PREFIX = "reimb:";

export function isReimbursementLine(line: PayLine): boolean {
  return Boolean(line.key?.startsWith(REIMBURSEMENT_PREFIX));
}

export function reimbursementTotal(earnings: PayLine[]): number {
  return round2(earnings.filter(isReimbursementLine).reduce((s, l) => s + l.amount, 0));
}

const auto = (key: string, name: string, amount: number): PayLine => ({ key, name, amount, source: "auto" });

export function computePay(input: PayInput): PayResult {
  const { counts, kind } = input;
  const fraction = counts.totalDays > 0 ? counts.payableDays / counts.totalDays : 0;
  const earnings: PayLine[] = [];
  const deductions: PayLine[] = [];

  // --- basic / stipend -----------------------------------------------------------------------
  let basic = 0;
  if (kind === "salary" && input.salary) {
    basic = round2(input.salary.basic * fraction);
    if (basic > 0) earnings.push(auto("basic", "Basic", basic));
    input.salary.allowances.forEach((a, i) => {
      const amount = round2(a.amount * fraction);
      if (amount > 0) earnings.push(auto(`allowance:${i}`, a.name, amount));
    });
  } else if (kind === "stipend" && input.stipend && counts.windowDays > 0) {
    const { amount, period } = input.stipend;
    basic = period === "one_time" ? round2(amount) : round2(amount * fraction);
    if (basic > 0) earnings.push(auto("stipend", period === "one_time" ? "Stipend (one-time)" : "Stipend", basic));
  }

  // --- configured components -------------------------------------------------------------------
  const applicable = input.components.filter((c) => c.active && c.appliesTo.includes(input.personType));
  for (const c of applicable.filter((x) => x.type === "earning")) {
    const amount = c.calc === "percent_basic" ? round2((basic * c.value) / 100) : round2(c.value * fraction);
    if (amount > 0) earnings.push(auto(`component:${c.key}`, c.name, amount));
  }

  // --- reimbursements ---------------------------------------------------------------------------
  for (const r of input.reimbursements) {
    if (r.amount > 0) earnings.push(auto(`${REIMBURSEMENT_PREFIX}${r.id}`, r.label, round2(r.amount)));
  }
  earnings.push(...input.manual.earnings);

  // --- deductions ----------------------------------------------------------------------------------
  if (counts.payableDays > 0) {
    if (kind === "salary" && input.salary) {
      input.salary.deductions.forEach((d, i) => {
        if (d.amount > 0) deductions.push(auto(`deduction:${i}`, d.name, round2(d.amount)));
      });
    }
    for (const c of applicable.filter((x) => x.type === "deduction")) {
      let amount = c.calc === "percent_basic" ? round2((basic * c.value) / 100) : round2(c.value);
      if (c.calc === "percent_basic" && c.cap !== undefined && c.cap > 0) amount = Math.min(amount, c.cap);
      if (amount > 0) deductions.push(auto(`component:${c.key}`, c.name, amount));
    }
  }
  deductions.push(...input.manual.deductions);

  // --- salary-advance recovery, never pushing net pay below zero ---------------------------------
  const advanceRecoveries: { advance: string; amount: number }[] = [];
  let headroom = round2(sum(earnings) - sum(deductions));
  for (const a of input.advances) {
    const amount = round2(Math.min(a.monthlyRecovery, a.remaining, Math.max(0, headroom)));
    if (amount <= 0) continue;
    deductions.push(auto(`advance:${a.id}`, a.label, amount));
    advanceRecoveries.push({ advance: a.id, amount });
    headroom = round2(headroom - amount);
  }

  const totals = totalsOf(earnings, deductions);
  return {
    basic,
    earnings,
    deductions,
    ...totals,
    advanceRecoveries,
    reimbursedExpenses: input.reimbursements.filter((r) => r.amount > 0).map((r) => r.id),
  };
}

/** "yyyy-MM" is a real, existing month. */
export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Last four characters preserved, the rest masked: "XXXXXX6624". */
export function maskTail(value: string | undefined | null, keep = 4, mask = "•"): string {
  const v = (value ?? "").replace(/\s+/g, "");
  if (!v) return "—";
  if (v.length <= keep) return v;
  return `${mask.repeat(Math.min(6, v.length - keep))}${v.slice(-keep)}`;
}

export interface PayslipFlag {
  label: string;
  /** red / amber flags are exceptions to review; blue ones are informational. */
  tone: "red" | "amber" | "blue";
}

/** Review notes for a payslip, derived from its own figures (no extra lookups). */
export function payslipFlags(p: {
  workingDays: number;
  payableDays: number;
  lopDays: number;
  gross: number;
  totalDeductions: number;
  snapshot: { bankAccount?: string };
  earnings: PayLine[];
  deductions: PayLine[];
}): PayslipFlag[] {
  const flags: PayslipFlag[] = [];
  if (p.lopDays > 0) flags.push({ label: `${p.lopDays} ${p.lopDays === 1 ? "day" : "days"} LOP`, tone: "amber" });
  if (p.lopDays === 0 && p.payableDays < p.workingDays) flags.push({ label: "Prorated", tone: "amber" });
  if (p.totalDeductions > p.gross) flags.push({ label: "Deductions exceed pay", tone: "red" });
  if (!p.snapshot.bankAccount) flags.push({ label: "No bank account", tone: "red" });
  if ([...p.earnings, ...p.deductions].some((l) => l.source === "manual")) flags.push({ label: "Adjusted", tone: "blue" });
  if (p.earnings.some(isReimbursementLine)) flags.push({ label: "Reimbursement", tone: "blue" });
  if (p.deductions.some((l) => l.key?.startsWith("advance:"))) flags.push({ label: "Advance recovery", tone: "blue" });
  return flags;
}
