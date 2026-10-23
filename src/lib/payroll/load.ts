import "server-only";
import { and, asc, eq, getTableColumns, gte, lte, ne, or, sql, type Column, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  Attendance,
  Department,
  Designation,
  Expense,
  LeaveRequest,
  LeaveType,
  PayrollRun,
  Payslip,
  SalaryAdvance,
  User,
  type Id,
  type IPayslip,
  type PayLine,
  type PayrollKind,
} from "@/lib/models";
import { inList, jsonHasField, jsonPath, notInList } from "@/lib/sql";
import { getSettings } from "@/lib/settings";
import { workCalendar } from "@/lib/domain/calendar";
import { EXITED_STATUSES } from "@/lib/people";
import { fmtDate, todayKey, monthRange } from "@/lib/time";
import { round2 } from "@/lib/format";
import {
  computePay,
  countDays,
  employmentWindow,
  type AdvanceInput,
  type LeaveSpan,
  type ManualLines,
  type PayResult,
  type ReimbursementInput,
} from "./calc";

/** Everything needed to write one Payslip document, as produced by `buildPayslips`. */
export interface PayslipCalc extends PayResult {
  userId: string;
  snapshot: IPayslip["snapshot"];
  workingDays: number;
  payableDays: number;
  lopDays: number;
  presentDays: number;
  leaveDays: number;
}

export interface SkippedPerson {
  userId: string;
  name: string;
  reason: string;
}

export interface BuildResult {
  /** Pay-basis days of the month (shown on the run). */
  workingDays: number;
  calcs: PayslipCalc[];
  skipped: SkippedPerson[];
}

const trunc = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * Works out the payslips of a run for a period (read-only). `runId` is the run being recalculated, so its own
 * reimbursements and one-time stipends are not treated as "already taken". `manual` carries the manual lines of
 * existing payslips so they survive a recalculation. `only` limits the calculation to some people.
 */
export async function buildPayslips(opts: { period: string; kind: PayrollKind; runId?: string; manual?: Map<string, ManualLines>; only?: string[] }): Promise<BuildResult> {
  const { period, kind } = opts;
  const { from, to } = monthRange(period);
  const today = todayKey();
  const settings = await getSettings();
  const calendar = await workCalendar(settings, from, to);
  const basis = settings.payroll.lopBasis;
  const emptyDays = {
    period,
    today,
    window: null,
    basis,
    isWorkingDay: calendar.isWorkingDay,
    leaves: [],
    attendance: new Map<string, string>(),
    trackingStartDate: settings.attendance.trackingStartDate || undefined,
  };
  const workingDays = countDays(emptyDays).totalDays;

  const users = await db()
    .select({
      _id: User._id,
      name: User.name,
      employeeId: User.employeeId,
      personType: User.personType,
      department: User.department,
      designation: User.designation,
      joiningDate: User.joiningDate,
      salary: User.salary,
      bank: User.bank,
      exit: User.exit,
      internship: User.internship,
    })
    .from(User)
    .where(
      and(
        inList(User.personType, ["employee", "trainee", "intern"]),
        or(notInList(User.status, EXITED_STATUSES), gte(jsonPath(User.exit, "lastWorkingDay"), from)),
        opts.only ? inList(User._id, opts.only) : undefined,
      ),
    )
    .orderBy(asc(User.name));

  const skipped: SkippedPerson[] = [];
  const stipendOf = (u: (typeof users)[number]) => (u.internship?.stipend?.eligible && u.internship.stipend.amount > 0 ? u.internship.stipend : undefined);

  // Decide who belongs to this kind of run.
  const included = users.filter((u) => {
    const isIntern = u.personType !== "employee";
    const stipend = stipendOf(u);
    if (kind === "stipend") {
      if (!isIntern || !stipend) return false;
      if (u.internship?.status === "registered") {
        skipped.push({ userId: u._id, name: u.name, reason: "Internship has not started" });
        return false;
      }
      return true;
    }
    // Salary run: employees, plus trainees / interns on a salary structure instead of a stipend.
    if (isIntern && (stipend || !(u.salary && u.salary.basic > 0))) return false;
    if (!(u.salary && u.salary.basic > 0)) {
      skipped.push({ userId: u._id, name: u.name, reason: "No salary structure" });
      return false;
    }
    return true;
  });
  const ids = included.map((u) => u._id);

  const cutoff = today < to ? today : to;
  const [leaveTypes, leaves, attendance, advances, expenses, designations, departments, activeRuns, stipendRuns] = await Promise.all([
    db().select({ _id: LeaveType._id, paid: LeaveType.paid }).from(LeaveType),
    db()
      .select({ user: LeaveRequest.user, startDate: LeaveRequest.startDate, endDate: LeaveRequest.endDate, halfDay: LeaveRequest.halfDay, leaveType: LeaveRequest.leaveType })
      .from(LeaveRequest)
      .where(and(inList(LeaveRequest.user, ids), eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, to), gte(LeaveRequest.endDate, from))),
    db()
      .select({ user: Attendance.user, date: Attendance.date, status: Attendance.status })
      .from(Attendance)
      .where(and(inList(Attendance.user, ids), gte(Attendance.date, from), lte(Attendance.date, cutoff))),
    db()
      .select()
      .from(SalaryAdvance)
      .where(and(inList(SalaryAdvance.user, ids), eq(SalaryAdvance.status, "open"), lte(SalaryAdvance.date, to))),
    db()
      .select({ _id: Expense._id, user: Expense.user, description: Expense.description, amount: Expense.amount })
      .from(Expense)
      .where(and(inList(Expense.user, ids), eq(Expense.status, "approved"), eq(Expense.type, "reimbursable")))
      .orderBy(asc(Expense.date)),
    db().select({ _id: Designation._id, name: Designation.name }).from(Designation),
    db().select({ _id: Department._id, name: Department.name }).from(Department),
    db()
      .select({ _id: PayrollRun._id })
      .from(PayrollRun)
      .where(and(inList(PayrollRun.status, ["draft", "verified", "approved"]), opts.runId ? ne(PayrollRun._id, opts.runId) : undefined)),
    kind === "stipend"
      ? db()
          .select({ _id: PayrollRun._id })
          .from(PayrollRun)
          .where(and(eq(PayrollRun.kind, "stipend"), ne(PayrollRun.status, "cancelled"), opts.runId ? ne(PayrollRun._id, opts.runId) : undefined))
      : Promise.resolve([]),
  ]);

  // Expenses and advance recoveries already picked up by another unfinished run (they only hit the books when that
  // run is paid), and one-time stipends paid before.
  const takenExpenses = new Set<string>();
  const reservedAdvance = new Map<string, number>();
  if (activeRuns.length > 0) {
    const others = await db()
      .select({ reimbursedExpenses: Payslip.reimbursedExpenses, advanceRecoveries: Payslip.advanceRecoveries })
      .from(Payslip)
      .where(inList(Payslip.run, activeRuns.map((r) => r._id)));
    for (const p of others) {
      for (const e of p.reimbursedExpenses) takenExpenses.add(e);
      for (const a of p.advanceRecoveries) reservedAdvance.set(a.advance, round2((reservedAdvance.get(a.advance) ?? 0) + a.amount));
    }
  }
  const paidOneTime = new Set<string>();
  if (stipendRuns.length > 0) {
    const prior = await db()
      .select({ user: Payslip.user })
      .from(Payslip)
      .where(and(inList(Payslip.run, stipendRuns.map((r) => r._id)), inList(Payslip.user, ids), jsonHasField(Payslip.earnings, "key", "stipend")));
    for (const p of prior) paidOneTime.add(p.user);
  }

  const paidType = new Map(leaveTypes.map((t) => [t._id, t.paid]));
  const designationName = new Map(designations.map((d) => [d._id, d.name]));
  const departmentName = new Map(departments.map((d) => [d._id, d.name]));
  const group = <T extends { user: Id }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(r.user, [...(map.get(r.user) ?? []), r]);
    return map;
  };
  const leavesBy = group(leaves);
  const attendanceBy = group(attendance);
  const advancesBy = group(advances);
  const expensesBy = group(expenses);

  const calcs: PayslipCalc[] = [];
  for (const u of included) {
    const id = u._id;
    const stipend = stipendOf(u);
    if (kind === "stipend" && stipend?.period === "one_time" && paidOneTime.has(id)) continue;

    const window =
      kind === "stipend"
        ? employmentWindow(period, { joined: u.joiningDate, startDate: u.internship?.startDate, left: u.exit?.lastWorkingDay, endDate: u.internship?.endDate })
        : employmentWindow(period, { joined: u.joiningDate, left: u.exit?.lastWorkingDay });
    if (!window) continue;

    const spans: LeaveSpan[] = (leavesBy.get(id) ?? []).map((l) => ({
      start: l.startDate,
      end: l.endDate,
      halfDay: l.halfDay,
      paid: paidType.get(l.leaveType) ?? true,
    }));
    const attendanceMap = new Map((attendanceBy.get(id) ?? []).map((a) => [a.date, a.status]));
    const counts = countDays({ ...emptyDays, window, leaves: spans, attendance: attendanceMap });

    const advanceInputs: AdvanceInput[] = (advancesBy.get(id) ?? [])
      .map((a) => ({ a, remaining: round2(a.amount - a.recovered - (reservedAdvance.get(a._id) ?? 0)) }))
      .filter(({ a, remaining }) => a.monthlyRecovery > 0 && remaining > 0 && !a.recoveries.some((r) => r.period === period))
      .map(({ a, remaining }) => ({ id: a._id, label: `Advance recovery · ${fmtDate(a.date)}`, monthlyRecovery: a.monthlyRecovery, remaining }));
    const reimbursements: ReimbursementInput[] = (expensesBy.get(id) ?? [])
      .filter((e) => !takenExpenses.has(e._id))
      .map((e) => ({ id: e._id, label: `Reimbursement · ${trunc(e.description, 48)}`, amount: e.amount }));

    const pay = computePay({
      kind,
      personType: u.personType,
      counts,
      salary: kind === "salary" && u.salary ? { basic: u.salary.basic, allowances: u.salary.allowances ?? [], deductions: u.salary.deductions ?? [] } : undefined,
      stipend: kind === "stipend" && stipend ? { amount: stipend.amount, period: stipend.period } : undefined,
      components: settings.payroll.components,
      advances: advanceInputs,
      reimbursements,
      manual: opts.manual?.get(id) ?? { earnings: [], deductions: [] },
    });

    calcs.push({
      ...pay,
      userId: id,
      snapshot: {
        name: u.name,
        employeeId: u.employeeId,
        designation: u.designation ? designationName.get(u.designation) : undefined,
        department: u.department ? departmentName.get(u.department) : undefined,
        joiningDate: u.joiningDate ?? undefined,
        bankAccount: u.bank?.accountNumber,
        ifsc: u.bank?.ifsc,
        bankName: u.bank?.bankName,
        pan: u.bank?.pan,
      },
      workingDays: counts.totalDays,
      payableDays: counts.payableDays,
      lopDays: counts.lopDays,
      presentDays: counts.presentDays,
      leaveDays: counts.leaveDays,
    });
  }
  return { workingDays, calcs, skipped };
}

/** Calculated fields of a payslip (everything that changes when it is recalculated). */
export function payslipFields(calc: PayslipCalc) {
  return {
    snapshot: calc.snapshot,
    workingDays: calc.workingDays,
    payableDays: calc.payableDays,
    lopDays: calc.lopDays,
    presentDays: calc.presentDays,
    leaveDays: calc.leaveDays,
    basic: calc.basic,
    earnings: calc.earnings as PayLine[],
    deductions: calc.deductions as PayLine[],
    gross: calc.gross,
    totalDeductions: calc.totalDeductions,
    net: calc.net,
    advanceRecoveries: calc.advanceRecoveries.map((a) => ({ advance: a.advance, amount: a.amount })),
    reimbursedExpenses: [...calc.reimbursedExpenses],
  };
}

/** Full Payslip row (without status) for a calculation. */
export function payslipDoc(calc: PayslipCalc, run: { id: string; period: string; kind: PayrollKind }) {
  return {
    run: run.id,
    user: calc.userId,
    period: run.period,
    kind: run.kind,
    ...payslipFields(calc),
  };
}

const insertPayslips = (rows: (typeof Payslip.$inferInsert)[]) => db().insert(Payslip).values(rows);

/**
 * INSERT statements for payslip rows, split to stay under D1's 100-bound-parameter limit. Run them with
 * `db().batch([...])` so a whole run is written in one round trip and one transaction.
 */
export function payslipInserts(rows: (typeof Payslip.$inferInsert)[]) {
  const size = Math.max(1, Math.floor(100 / Object.keys(getTableColumns(Payslip)).length));
  const statements: ReturnType<typeof insertPayslips>[] = [];
  for (let i = 0; i < rows.length; i += size) statements.push(insertPayslips(rows.slice(i, i + size)));
  return statements;
}

/**
 * UPDATE that recomputes the run's headcount and money totals from its payslips. Returned as a statement so it can
 * run inside a `db().batch` after the payslip writes it summarises.
 */
export function runTotalsUpdate(runId: Id, workingDays?: number) {
  const agg = (expr: SQL) => sql`(select ${expr} from ${Payslip} where ${Payslip.run} = ${runId})`;
  const money = (col: Column) => agg(sql`round(coalesce(sum(${col}), 0), 2)`);
  return db()
    .update(PayrollRun)
    .set({
      totals: sql`json_object('count', ${agg(sql`count(*)`)}, 'gross', ${money(Payslip.gross)}, 'deductions', ${money(Payslip.totalDeductions)}, 'net', ${money(Payslip.net)})`,
      ...(workingDays !== undefined ? { workingDays } : {}),
    })
    .where(eq(PayrollRun._id, runId));
}

/** Recomputes the run's headcount and money totals from its payslips. */
export async function refreshRunTotals(runId: Id, workingDays?: number): Promise<void> {
  await runTotalsUpdate(runId, workingDays);
}
