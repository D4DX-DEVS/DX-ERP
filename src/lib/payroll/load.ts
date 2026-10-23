import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
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
  type IPayslip,
  type PayLine,
  type PayrollKind,
} from "@/lib/models";
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
  await connectDB();
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

  const users = await User.find(
    {
      personType: { $in: ["employee", "trainee", "intern"] },
      $or: [{ status: { $nin: EXITED_STATUSES } }, { "exit.lastWorkingDay": { $gte: from } }],
      ...(opts.only ? { _id: { $in: opts.only } } : {}),
    },
    { name: 1, employeeId: 1, personType: 1, department: 1, designation: 1, joiningDate: 1, salary: 1, bank: 1, exit: 1, internship: 1 },
  )
    .sort({ name: 1 })
    .lean();

  const skipped: SkippedPerson[] = [];
  const stipendOf = (u: (typeof users)[number]) => (u.internship?.stipend?.eligible && u.internship.stipend.amount > 0 ? u.internship.stipend : undefined);

  // Decide who belongs to this kind of run.
  const included = users.filter((u) => {
    const isIntern = u.personType !== "employee";
    const stipend = stipendOf(u);
    if (kind === "stipend") {
      if (!isIntern || !stipend) return false;
      if (u.internship?.status === "registered") {
        skipped.push({ userId: u._id.toString(), name: u.name, reason: "Internship has not started" });
        return false;
      }
      return true;
    }
    // Salary run: employees, plus trainees / interns on a salary structure instead of a stipend.
    if (isIntern && (stipend || !(u.salary && u.salary.basic > 0))) return false;
    if (!(u.salary && u.salary.basic > 0)) {
      skipped.push({ userId: u._id.toString(), name: u.name, reason: "No salary structure" });
      return false;
    }
    return true;
  });
  const ids = included.map((u) => u._id);

  const cutoff = today < to ? today : to;
  const [leaveTypes, leaves, attendance, advances, expenses, designations, departments, activeRuns, stipendRuns] = await Promise.all([
    LeaveType.find({}, { paid: 1 }).lean(),
    LeaveRequest.find({ user: { $in: ids }, status: "approved", startDate: { $lte: to }, endDate: { $gte: from } }, { user: 1, startDate: 1, endDate: 1, halfDay: 1, leaveType: 1 }).lean(),
    Attendance.find({ user: { $in: ids }, date: { $gte: from, $lte: cutoff } }, { user: 1, date: 1, status: 1 }).lean(),
    SalaryAdvance.find({ user: { $in: ids }, status: "open", date: { $lte: to } }).lean(),
    Expense.find({ user: { $in: ids }, status: "approved", type: "reimbursable" }, { user: 1, description: 1, amount: 1 }).sort({ date: 1 }).lean(),
    Designation.find({}, { name: 1 }).lean(),
    Department.find({}, { name: 1 }).lean(),
    PayrollRun.find({ status: { $in: ["draft", "verified", "approved"] }, ...(opts.runId ? { _id: { $ne: opts.runId } } : {}) }, { _id: 1 }).lean(),
    kind === "stipend" ? PayrollRun.find({ kind: "stipend", status: { $ne: "cancelled" }, ...(opts.runId ? { _id: { $ne: opts.runId } } : {}) }, { _id: 1 }).lean() : Promise.resolve([]),
  ]);

  // Expenses and advance recoveries already picked up by another unfinished run (they only hit the books when that
  // run is paid), and one-time stipends paid before.
  const takenExpenses = new Set<string>();
  const reservedAdvance = new Map<string, number>();
  if (activeRuns.length > 0) {
    const others = await Payslip.find({ run: { $in: activeRuns.map((r) => r._id) } }, { reimbursedExpenses: 1, advanceRecoveries: 1 }).lean();
    for (const p of others) {
      for (const e of p.reimbursedExpenses) takenExpenses.add(e.toString());
      for (const a of p.advanceRecoveries) reservedAdvance.set(a.advance.toString(), round2((reservedAdvance.get(a.advance.toString()) ?? 0) + a.amount));
    }
  }
  const paidOneTime = new Set<string>();
  if (stipendRuns.length > 0) {
    const prior = await Payslip.find({ run: { $in: stipendRuns.map((r) => r._id) }, user: { $in: ids }, "earnings.key": "stipend" }, { user: 1 }).lean();
    for (const p of prior) paidOneTime.add(p.user.toString());
  }

  const paidType = new Map(leaveTypes.map((t) => [t._id.toString(), t.paid]));
  const designationName = new Map(designations.map((d) => [d._id.toString(), d.name]));
  const departmentName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const group = <T extends { user: Types.ObjectId }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(r.user.toString(), [...(map.get(r.user.toString()) ?? []), r]);
    return map;
  };
  const leavesBy = group(leaves);
  const attendanceBy = group(attendance);
  const advancesBy = group(advances);
  const expensesBy = group(expenses);

  const calcs: PayslipCalc[] = [];
  for (const u of included) {
    const id = u._id.toString();
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
      paid: paidType.get(l.leaveType.toString()) ?? true,
    }));
    const attendanceMap = new Map((attendanceBy.get(id) ?? []).map((a) => [a.date, a.status]));
    const counts = countDays({ ...emptyDays, window, leaves: spans, attendance: attendanceMap });

    const advanceInputs: AdvanceInput[] = (advancesBy.get(id) ?? [])
      .map((a) => ({ a, remaining: round2(a.amount - a.recovered - (reservedAdvance.get(a._id.toString()) ?? 0)) }))
      .filter(({ a, remaining }) => a.monthlyRecovery > 0 && remaining > 0 && !a.recoveries.some((r) => r.period === period))
      .map(({ a, remaining }) => ({ id: a._id.toString(), label: `Advance recovery · ${fmtDate(a.date)}`, monthlyRecovery: a.monthlyRecovery, remaining }));
    const reimbursements: ReimbursementInput[] = (expensesBy.get(id) ?? [])
      .filter((e) => !takenExpenses.has(e._id.toString()))
      .map((e) => ({ id: e._id.toString(), label: `Reimbursement · ${trunc(e.description, 48)}`, amount: e.amount }));

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
        designation: u.designation ? designationName.get(u.designation.toString()) : undefined,
        department: u.department ? departmentName.get(u.department.toString()) : undefined,
        joiningDate: u.joiningDate,
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
    advanceRecoveries: calc.advanceRecoveries.map((a) => ({ advance: new Types.ObjectId(a.advance), amount: a.amount })),
    reimbursedExpenses: calc.reimbursedExpenses.map((e) => new Types.ObjectId(e)),
  };
}

/** Full Payslip document (without status) for a calculation. */
export function payslipDoc(calc: PayslipCalc, run: { id: string; period: string; kind: PayrollKind }) {
  return {
    run: new Types.ObjectId(run.id),
    user: new Types.ObjectId(calc.userId),
    period: run.period,
    kind: run.kind,
    ...payslipFields(calc),
  };
}

/** Recomputes the run's headcount and money totals from its payslips. */
export async function refreshRunTotals(runId: string | Types.ObjectId, workingDays?: number): Promise<void> {
  await connectDB();
  const [agg] = await Payslip.aggregate<{ count: number; gross: number; deductions: number; net: number }>([
    { $match: { run: new Types.ObjectId(runId.toString()) } },
    { $group: { _id: null, count: { $sum: 1 }, gross: { $sum: "$gross" }, deductions: { $sum: "$totalDeductions" }, net: { $sum: "$net" } } },
  ]);
  await PayrollRun.updateOne(
    { _id: runId },
    {
      $set: {
        totals: { count: agg?.count ?? 0, gross: round2(agg?.gross ?? 0), deductions: round2(agg?.deductions ?? 0), net: round2(agg?.net ?? 0) },
        ...(workingDays !== undefined ? { workingDays } : {}),
      },
    },
  );
}
