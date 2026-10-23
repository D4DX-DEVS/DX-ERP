import "server-only";
import { cache } from "react";
import { and, asc, count, desc, eq, gt, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  Attendance,
  AttendanceCorrection,
  Designation,
  Expense,
  Invoice,
  LeaveRequest,
  Movement,
  PayrollRun,
  Payment,
  PERSON_TYPES,
  Task,
  TimesheetEntry,
  User,
  type Id,
} from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { workCalendar } from "@/lib/domain/calendar";
import { directReportIds, EXITED_STATUSES, namesFor } from "@/lib/people";
import { fyOf } from "@/lib/reports/shared";
import { getSettings } from "@/lib/settings";
import { inList, jsonHas, notInList } from "@/lib/sql";
import { addMonths, monthKey, monthRange, todayKey, zonedDateTime } from "@/lib/time";

/* ---------------------------------------------------------------- periods */

export interface Periods {
  today: string;
  month: string;
  prevMonth: string;
  monthFrom: string;
  prevFrom: string;
  prevTo: string;
  fy: { from: string; to: string; label: string };
  fyStartMonth: string;
  /** Oldest month any summary needs (start of the financial year or last month, whichever is earlier). */
  sinceMonth: string;
}

export const getPeriods = cache((): Periods => {
  const today = todayKey();
  const month = monthKey();
  const prevMonth = addMonths(month, -1);
  const prev = monthRange(prevMonth);
  const fy = fyOf(today);
  const fyStartMonth = fy.from.slice(0, 7);
  return { today, month, prevMonth, monthFrom: `${month}-01`, prevFrom: prev.from, prevTo: prev.to, fy, fyStartMonth, sinceMonth: [fyStartMonth, prevMonth, addMonths(month, -6)].sort()[0] };
});

/* -------------------------------------------------------------- headcount */

export interface Headcount {
  employees: number;
  trainees: number;
  interns: number;
  total: number;
}

export const loadHeadcount = cache(async (): Promise<Headcount> => {
  const rows = await db()
    .select({ type: User.personType, n: count() })
    .from(User)
    .where(and(inList(User.personType, PERSON_TYPES), notInList(User.status, EXITED_STATUSES)))
    .groupBy(User.personType);
  const get = (type: string) => rows.find((r) => r.type === type)?.n ?? 0;
  const employees = get("employee");
  const trainees = get("trainee");
  const interns = get("intern");
  return { employees, trainees, interns, total: employees + trainees + interns };
});

/* ------------------------------------------------------- attendance today */

export interface AttendanceToday {
  total: number;
  present: number;
  late: number;
  onLeave: number;
  /** Not checked in and not on leave. */
  absent: number;
  /** True while it is still early enough that missing check-ins are "not in yet" rather than absent. */
  early: boolean;
  workingDay: boolean;
  holiday?: string;
}

function beforeAbsenceCutoff(settings: AppSettings, today: string): boolean {
  const cutoff = zonedDateTime(today, settings.attendance.officeStart).getTime() + settings.attendance.graceMinutes * 60_000;
  return Date.now() < cutoff;
}

export const loadAttendanceToday = cache(async (): Promise<AttendanceToday> => {
  const settings = await getSettings();
  const { today } = getPeriods();
  const [headcount, cal, docs, leaveUsers] = await Promise.all([
    loadHeadcount(),
    workCalendar(settings, today, today),
    db()
      .select({ user: Attendance.user, late: Attendance.late })
      .from(Attendance)
      .where(and(eq(Attendance.date, today), isNotNull(Attendance.checkIn))),
    db()
      .selectDistinct({ user: LeaveRequest.user })
      .from(LeaveRequest)
      .where(and(eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, today), gte(LeaveRequest.endDate, today), eq(LeaveRequest.halfDay, false))),
  ]);
  const present = new Set(docs.map((d) => d.user));
  const onLeave = leaveUsers.filter((u) => !present.has(u.user)).length;
  const workingDay = cal.isWorkingDay(today);
  return {
    total: headcount.total,
    present: present.size,
    late: docs.filter((d) => d.late).length,
    onLeave,
    absent: workingDay ? Math.max(0, headcount.total - present.size - onLeave) : 0,
    early: beforeAbsenceCutoff(settings, today),
    workingDay,
    holiday: cal.holidays.get(today),
  };
});

/* ------------------------------------------------------ open movements */

export type OpenMovementState = "out" | "overdue" | "missing_in";

export interface OpenMovement {
  id: string;
  personId: string;
  official: boolean;
  categoryLabel: string;
  purpose: string;
  destination?: string;
  date: string;
  outTime?: Date;
  expectedReturn?: Date;
  state: OpenMovementState;
}

export interface OpenMovements {
  rows: OpenMovement[];
  /** Out today. */
  outside: number;
  /** Out today and past the expected return plus grace. */
  overdue: number;
  /** Still open from an earlier day (In-Time never recorded). */
  missing: number;
  people: Map<string, { name: string; designation?: string }>;
}

/** Where an open (still "out") movement stands: fine, past its expected return, or left open from an earlier day. */
export function classifyOpenMovement(m: { date: string; expectedReturn?: Date | null }, settings: AppSettings, today: string): OpenMovementState {
  if (m.date < today) return "missing_in";
  const grace = settings.movement.overdueGraceMinutes * 60_000;
  return m.expectedReturn && Date.now() > m.expectedReturn.getTime() + grace ? "overdue" : "out";
}

export const loadOpenMovements = cache(async (): Promise<OpenMovements> => {
  const settings = await getSettings();
  const { today } = getPeriods();
  const docs = await db()
    .select({
      _id: Movement._id,
      user: Movement.user,
      date: Movement.date,
      outTime: Movement.outTime,
      expectedReturn: Movement.expectedReturn,
      purpose: Movement.purpose,
      destination: Movement.destination,
      categoryLabel: Movement.categoryLabel,
      official: Movement.official,
    })
    .from(Movement)
    .where(eq(Movement.status, "out"))
    .orderBy(asc(Movement.outTime))
    .limit(200);
  const rows: OpenMovement[] = docs.map((m) => {
    return {
      id: m._id,
      personId: m.user,
      official: m.official,
      categoryLabel: m.categoryLabel,
      purpose: m.purpose,
      destination: m.destination ?? undefined,
      date: m.date,
      outTime: m.outTime ?? undefined,
      expectedReturn: m.expectedReturn ?? undefined,
      state: classifyOpenMovement(m, settings, today),
    };
  });
  // Most urgent first: earlier-day (missing In-Time), then overdue, then everyone else by Out-Time.
  const rank: Record<OpenMovementState, number> = { missing_in: 0, overdue: 1, out: 2 };
  rows.sort((a, b) => rank[a.state] - rank[b.state] || (a.outTime?.getTime() ?? 0) - (b.outTime?.getTime() ?? 0));
  // Name + designation of the people involved, in one query (the dashboard has a small per-request query budget).
  const ids = [...new Set(rows.map((r) => r.personId))];
  const people = new Map<string, { name: string; designation?: string }>();
  if (ids.length > 0) {
    const found = await db()
      .select({ id: User._id, name: User.name, designation: Designation.name })
      .from(User)
      .leftJoin(Designation, eq(Designation._id, User.designation))
      .where(inList(User._id, ids));
    for (const u of found) people.set(u.id, { name: u.name, designation: u.designation ?? undefined });
  }
  return {
    rows,
    outside: rows.filter((r) => r.state !== "missing_in").length,
    overdue: rows.filter((r) => r.state === "overdue").length,
    missing: rows.filter((r) => r.state === "missing_in").length,
    people,
  };
});

/* ------------------------------------------------------ approval queues */

export type QueueKey = "leave" | "movement" | "attendance" | "expenses" | "timesheets" | "payroll";

export interface ApprovalQueue {
  key: QueueKey;
  label: string;
  singular: string;
  count: number;
  href: string;
  oldest?: { who?: string; at: Date };
}

/** Direct reports of a person, fetched once per request (shared by `isReportingManager` and the approval queues). */
const reportsOf = cache((userId: string) => directReportIds(userId));

export const isReportingManager = cache(async (userId: string): Promise<boolean> => (await reportsOf(userId)).length > 0);

/** Everything waiting on this person, based on their approval permissions and direct reports. */
export const loadApprovalQueues = cache(async (user: CurrentUser): Promise<ApprovalQueue[]> => {
  const me = user._id;
  const reports = await reportsOf(me);

  type Summary = { count: number; oldest?: { user?: Id | null; at?: Date | null } };
  /** Matching-row count next to the oldest row, in one query (`count(*) over ()` counts before `limit`). */
  const total = sql<number>`count(*) over ()`.mapWith(Number);
  const defs: { key: QueueKey; label: string; singular: string; href: string; load: () => Promise<Summary> }[] = [];

  // Leave: manager step for direct reports, HR step for holders of leave.approve.
  const leaveFilter = and(
    ne(LeaveRequest.user, me),
    or(and(eq(LeaveRequest.status, "pending_manager"), eq(LeaveRequest.manager, me)), can(user, "leave.approve") ? eq(LeaveRequest.status, "pending_hr") : undefined),
  );
  defs.push({
    key: "leave",
    label: "Leave",
    singular: "leave request",
    href: "/leave/approvals",
    load: async () => {
      const [row] = await db().select({ user: LeaveRequest.user, at: LeaveRequest.createdAt, n: total }).from(LeaveRequest).where(leaveFilter).orderBy(asc(LeaveRequest.createdAt)).limit(1);
      return { count: row?.n ?? 0, oldest: row ? { user: row.user, at: row.at } : undefined };
    },
  });

  const pendingApproval = inList(Movement.approvalStatus, ["pending", "correction_requested"]);
  const movementFilter = can(user, "movement.approve") ? and(pendingApproval, ne(Movement.user, me)) : and(pendingApproval, eq(Movement.approver, me));
  defs.push({
    key: "movement",
    label: "Movement",
    singular: "movement",
    href: "/movement?tab=approvals",
    load: async () => {
      const [row] = await db().select({ user: Movement.user, at: Movement.createdAt, n: total }).from(Movement).where(movementFilter).orderBy(asc(Movement.createdAt)).limit(1);
      return { count: row?.n ?? 0, oldest: row ? { user: row.user, at: row.at } : undefined };
    },
  });

  if (can(user, "attendance.approve") || reports.length > 0) {
    const f = can(user, "attendance.approve")
      ? and(eq(AttendanceCorrection.status, "pending"), ne(AttendanceCorrection.user, me))
      : and(eq(AttendanceCorrection.status, "pending"), inList(AttendanceCorrection.user, reports));
    defs.push({
      key: "attendance",
      label: "Attendance corrections",
      singular: "attendance correction",
      href: "/attendance/corrections",
      load: async () => {
        const [row] = await db()
          .select({ user: AttendanceCorrection.user, at: AttendanceCorrection.createdAt, n: total })
          .from(AttendanceCorrection)
          .where(f)
          .orderBy(asc(AttendanceCorrection.createdAt))
          .limit(1);
        return { count: row?.n ?? 0, oldest: row ? { user: row.user, at: row.at } : undefined };
      },
    });
  }

  if (can(user, "expenses.approve")) {
    const f = and(eq(Expense.status, "submitted"), ne(Expense.user, me));
    defs.push({
      key: "expenses",
      label: "Expenses",
      singular: "expense claim",
      href: "/expenses",
      load: async () => {
        const [row] = await db().select({ user: Expense.user, at: Expense.submittedAt, n: total }).from(Expense).where(f).orderBy(asc(Expense.submittedAt)).limit(1);
        return { count: row?.n ?? 0, oldest: row ? { user: row.user, at: row.at } : undefined };
      },
    });
  }

  // Timesheets are approved per person-week, so count distinct user + week pairs.
  if (can(user, "timesheets.approve") || reports.length > 0) {
    const f = can(user, "timesheets.approve")
      ? and(eq(TimesheetEntry.status, "submitted"), ne(TimesheetEntry.user, me))
      : and(eq(TimesheetEntry.status, "submitted"), inList(TimesheetEntry.user, reports));
    defs.push({
      key: "timesheets",
      label: "Timesheets",
      singular: "timesheet",
      href: "/timesheets/approvals",
      load: async () => {
        // The oldest submission and the number of distinct person-weeks, in one query.
        const pairs = sql<number>`(select count(distinct ${TimesheetEntry.user} || '|' || ${TimesheetEntry.weekStart}) from ${TimesheetEntry} where ${f})`.mapWith(Number);
        const [row] = await db().select({ user: TimesheetEntry.user, at: TimesheetEntry.submittedAt, n: pairs }).from(TimesheetEntry).where(f).orderBy(asc(TimesheetEntry.submittedAt)).limit(1);
        return { count: row?.n ?? 0, oldest: row ? { user: row.user, at: row.at } : undefined };
      },
    });
  }

  if (can(user, "payroll.approve")) {
    defs.push({
      key: "payroll",
      label: "Payroll",
      singular: "payroll run",
      href: "/payroll",
      load: async () => {
        const [row] = await db().select({ at: PayrollRun.verifiedAt, n: total }).from(PayrollRun).where(eq(PayrollRun.status, "verified")).orderBy(asc(PayrollRun.verifiedAt)).limit(1);
        return { count: row?.n ?? 0, oldest: row ? { at: row.at } : undefined };
      },
    });
  }

  const loaded = (await Promise.all(defs.map(async (d) => ({ d, s: await d.load() })))).filter((x) => x.s.count > 0);
  const names = await namesFor(loaded.map((x) => x.s.oldest?.user));
  return loaded.map(({ d, s }) => ({
    key: d.key,
    label: d.label,
    singular: d.singular,
    count: s.count,
    href: d.href,
    oldest: s.oldest?.at ? { who: s.oldest.user ? names.get(s.oldest.user) : undefined, at: s.oldest.at } : undefined,
  }));
});

/* ---------------------------------------------------------------- finance */

export interface FinanceSeries {
  /** Per month ("yyyy-MM"), from `since` to the current month. */
  invoiced: Map<string, number>;
  invoiceCount: Map<string, number>;
  collected: Map<string, number>;
  expenses: Map<string, number>;
  outstanding: number;
  overdueCount: number;
  overdueAmount: number;
}

export const loadFinance = cache(async (): Promise<FinanceSeries> => {
  const { sinceMonth, today } = getPeriods();
  const lo = `${sinceMonth}-01`;
  const invoiceMonth = sql<string>`substr(${Invoice.issueDate}, 1, 7)`;
  const paymentMonth = sql<string>`substr(${Payment.date}, 1, 7)`;
  const expenseMonth = sql<string>`substr(${Expense.date}, 1, 7)`;
  const [invoiced, payments, expenses, [open]] = await Promise.all([
    db()
      .select({ month: invoiceMonth, total: sql<number>`coalesce(sum(${Invoice.total}), 0)`.mapWith(Number), count: count() })
      .from(Invoice)
      .where(and(gte(Invoice.issueDate, lo), notInList(Invoice.status, ["draft", "cancelled"])))
      .groupBy(invoiceMonth),
    db()
      .select({ month: paymentMonth, type: Payment.type, amount: sql<number>`coalesce(sum(${Payment.amount}), 0)`.mapWith(Number) })
      .from(Payment)
      .where(and(gte(Payment.date, lo), inList(Payment.type, ["payment", "refund"])))
      .groupBy(paymentMonth, Payment.type),
    db()
      .select({ month: expenseMonth, amount: sql<number>`coalesce(sum(${Expense.amount}), 0)`.mapWith(Number) })
      .from(Expense)
      .where(and(gte(Expense.date, lo), inList(Expense.status, ["approved", "paid"])))
      .groupBy(expenseMonth),
    db()
      .select({
        outstanding: sql<number>`coalesce(sum(${Invoice.balance}), 0)`.mapWith(Number),
        overdueCount: sql<number>`coalesce(sum(case when ${Invoice.dueDate} < ${today} then 1 else 0 end), 0)`.mapWith(Number),
        overdueAmount: sql<number>`coalesce(sum(case when ${Invoice.dueDate} < ${today} then ${Invoice.balance} else 0 end), 0)`.mapWith(Number),
      })
      .from(Invoice)
      .where(and(inList(Invoice.status, ["issued", "partially_paid", "overdue"]), gt(Invoice.balance, 0))),
  ]);
  const collected = new Map<string, number>();
  for (const p of payments) collected.set(p.month, (collected.get(p.month) ?? 0) + (p.type === "refund" ? -Math.abs(p.amount) : p.amount));
  return {
    invoiced: new Map(invoiced.map((i) => [i.month, i.total])),
    invoiceCount: new Map(invoiced.map((i) => [i.month, i.count])),
    collected,
    expenses: new Map(expenses.map((e) => [e.month, e.amount])),
    outstanding: open?.outstanding ?? 0,
    overdueCount: open?.overdueCount ?? 0,
    overdueAmount: open?.overdueAmount ?? 0,
  };
});

/* ------------------------------------------------------ operational summary */

export interface MonthlyTotals {
  attendedDays: Map<string, number>;
  workMinutes: Map<string, number>;
  movements: Map<string, number>;
  tasksDone: Map<string, number>;
}

export const loadMonthlyOps = cache(
  async (flags: { attendance: boolean; movements: boolean; tasks: boolean }): Promise<MonthlyTotals> => {
    const { sinceMonth } = getPeriods();
    const lo = `${sinceMonth}-01`;
    const attendanceMonth = sql<string>`substr(${Attendance.date}, 1, 7)`;
    const movementMonth = sql<string>`substr(${Movement.date}, 1, 7)`;
    const [attendance, movements, tasks] = await Promise.all([
      flags.attendance
        ? db()
            .select({ month: attendanceMonth, days: count(), minutes: sql<number>`coalesce(sum(${Attendance.workMinutes}), 0)`.mapWith(Number) })
            .from(Attendance)
            .where(and(gte(Attendance.date, lo), isNotNull(Attendance.checkIn)))
            .groupBy(attendanceMonth)
        : [],
      flags.movements
        ? db()
            .select({ month: movementMonth, n: count() })
            .from(Movement)
            .where(and(gte(Movement.date, lo), inList(Movement.status, ["out", "returned"])))
            .groupBy(movementMonth)
        : [],
      // Months are the company-zone month of the completion instant, so bucket them here rather than in SQL.
      flags.tasks ? db().select({ completedAt: Task.completedAt }).from(Task).where(gte(Task.completedAt, zonedDateTime(lo, "00:00"))) : [],
    ]);
    const tasksDone = new Map<string, number>();
    for (const t of tasks) {
      if (!t.completedAt) continue;
      const m = monthKey(t.completedAt);
      tasksDone.set(m, (tasksDone.get(m) ?? 0) + 1);
    }
    return {
      attendedDays: new Map(attendance.map((a) => [a.month, a.days])),
      workMinutes: new Map(attendance.map((a) => [a.month, a.minutes])),
      movements: new Map(movements.map((m) => [m.month, m.n])),
      tasksDone,
    };
  },
  );

/** Sum of a month map over an inclusive month range. */
export function sumMonths(map: Map<string, number>, from: string, to: string): number {
  let total = 0;
  for (const [month, value] of map) if (month >= from && month <= to) total += value;
  return total;
}

/* ---------------------------------------------------------------- tasks */

export interface OpenTask {
  id: string;
  taskNo: string;
  title: string;
  project?: Id;
  status: string;
  priority: string;
  dueDate?: string;
  progress: number;
  submissions: { submittedBy: Id; reviewStatus: string; submittedAt: Date; reviewNote?: string }[];
}

/** A person's open tasks, soonest deadline first with undated tasks last. `shared` also includes tasks shared with them. */
export async function loadOpenTasks(userId: Id, closedStatuses: string[], limit: number, shared = false): Promise<{ tasks: OpenTask[]; total: number }> {
  const scope = shared ? or(jsonHas(Task.assignees, userId), jsonHas(Task.sharedWith, userId)) : jsonHas(Task.assignees, userId);
  const base = and(scope, notInList(Task.status, closedStatuses));
  const columns = {
    _id: Task._id,
    taskNo: Task.taskNo,
    title: Task.title,
    project: Task.project,
    status: Task.status,
    priority: Task.priority,
    dueDate: Task.dueDate,
    progress: Task.progress,
    submissions: Task.submissions,
  };
  const [dated, total] = await Promise.all([
    db()
      .select(columns)
      .from(Task)
      .where(and(base, isNotNull(Task.dueDate), ne(Task.dueDate, "")))
      .orderBy(asc(Task.dueDate))
      .limit(limit),
    db().$count(Task, base),
  ]);
  const undated =
    dated.length < limit
      ? await db()
          .select(columns)
          .from(Task)
          .where(and(base, or(isNull(Task.dueDate), eq(Task.dueDate, ""))))
          .orderBy(desc(Task.updatedAt))
          .limit(limit - dated.length)
      : [];
  const tasks = [...dated, ...undated].map((t) => ({
    id: t._id,
    taskNo: t.taskNo,
    title: t.title,
    project: t.project ?? undefined,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate || undefined,
    progress: t.progress,
    submissions: t.submissions.map((s) => ({ submittedBy: s.submittedBy, reviewStatus: s.reviewStatus, submittedAt: s.submittedAt, reviewNote: s.reviewNote })),
  }));
  return { tasks, total };
}
