import "server-only";
import { cache } from "react";
import type { Types } from "mongoose";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import {
  Attendance,
  AttendanceCorrection,
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
} from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { workCalendar } from "@/lib/domain/calendar";
import { EXITED_STATUSES } from "@/lib/people";
import { fyOf, peopleMap, type PersonInfo } from "@/lib/reports/shared";
import { getSettings } from "@/lib/settings";
import { addMonths, monthKey, monthRange, TZ, todayKey, zonedDateTime } from "@/lib/time";

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
  await connectDB();
  const rows = await User.aggregate<{ _id: string; n: number }>([
    { $match: { personType: { $in: PERSON_TYPES }, status: { $nin: EXITED_STATUSES } } },
    { $group: { _id: "$personType", n: { $sum: 1 } } },
  ]);
  const get = (type: string) => rows.find((r) => r._id === type)?.n ?? 0;
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
  await connectDB();
  const settings = await getSettings();
  const { today } = getPeriods();
  const [headcount, cal, docs, leaveUsers] = await Promise.all([
    loadHeadcount(),
    workCalendar(settings, today, today),
    Attendance.find({ date: today, checkIn: { $exists: true } }, { user: 1, late: 1 }).lean(),
    LeaveRequest.distinct("user", { status: "approved", startDate: { $lte: today }, endDate: { $gte: today }, halfDay: false }),
  ]);
  const present = new Set(docs.map((d) => d.user.toString()));
  const onLeave = leaveUsers.filter((u) => !present.has(u.toString())).length;
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
  people: Map<string, PersonInfo>;
}

/** Where an open (still "out") movement stands: fine, past its expected return, or left open from an earlier day. */
export function classifyOpenMovement(m: { date: string; expectedReturn?: Date }, settings: AppSettings, today: string): OpenMovementState {
  if (m.date < today) return "missing_in";
  const grace = settings.movement.overdueGraceMinutes * 60_000;
  return m.expectedReturn && Date.now() > m.expectedReturn.getTime() + grace ? "overdue" : "out";
}

export const loadOpenMovements = cache(async (): Promise<OpenMovements> => {
  await connectDB();
  const settings = await getSettings();
  const { today } = getPeriods();
  const docs = await Movement.find({ status: "out" }, { user: 1, date: 1, outTime: 1, expectedReturn: 1, purpose: 1, destination: 1, categoryLabel: 1, official: 1 }).sort({ outTime: 1 }).limit(200).lean();
  const rows: OpenMovement[] = docs.map((m) => {
    return {
      id: m._id.toString(),
      personId: m.user.toString(),
      official: m.official,
      categoryLabel: m.categoryLabel,
      purpose: m.purpose,
      destination: m.destination,
      date: m.date,
      outTime: m.outTime,
      expectedReturn: m.expectedReturn,
      state: classifyOpenMovement(m, settings, today),
    };
  });
  // Most urgent first: earlier-day (missing In-Time), then overdue, then everyone else by Out-Time.
  const rank: Record<OpenMovementState, number> = { missing_in: 0, overdue: 1, out: 2 };
  rows.sort((a, b) => rank[a.state] - rank[b.state] || (a.outTime?.getTime() ?? 0) - (b.outTime?.getTime() ?? 0));
  return {
    rows,
    outside: rows.filter((r) => r.state !== "missing_in").length,
    overdue: rows.filter((r) => r.state === "overdue").length,
    missing: rows.filter((r) => r.state === "missing_in").length,
    people: await peopleMap(rows.map((r) => r.personId)),
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

export const isReportingManager = cache(async (userId: string): Promise<boolean> => {
  await connectDB();
  return Boolean(await User.exists({ reportingManager: userId }));
});

/** Everything waiting on this person, based on their approval permissions and direct reports. */
export const loadApprovalQueues = cache(async (user: CurrentUser): Promise<ApprovalQueue[]> => {
  await connectDB();
  const me = user._id;
  const reports: Types.ObjectId[] = await User.distinct("_id", { reportingManager: me });

  type Summary = { count: number; oldest?: { user?: Types.ObjectId; at?: Date } };
  const queue = async (key: QueueKey, label: string, singular: string, href: string, load: () => Promise<Summary>): Promise<ApprovalQueue | null> => {
    const { count, oldest } = await load();
    if (count === 0) return null;
    const who = oldest?.user ? (await peopleMap([oldest.user])).get(oldest.user.toString())?.name : undefined;
    return { key, label, singular, count, href, oldest: oldest?.at ? { who, at: oldest.at } : undefined };
  };
  const queues: Promise<ApprovalQueue | null>[] = [];

  // Leave: manager step for direct reports, HR step for holders of leave.approve.
  const leaveFilter: Record<string, unknown> = {
    user: { $ne: me },
    $or: [{ status: "pending_manager", manager: me }, ...(can(user, "leave.approve") ? [{ status: "pending_hr" }] : [])],
  };
  queues.push(
    queue("leave", "Leave", "leave request", "/leave/approvals", async () => {
      const [count, doc] = await Promise.all([LeaveRequest.countDocuments(leaveFilter), LeaveRequest.findOne(leaveFilter, { user: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean()]);
      return { count, oldest: doc ? { user: doc.user, at: doc.createdAt } : undefined };
    }),
  );

  const movementFilter: Record<string, unknown> = can(user, "movement.approve")
    ? { approvalStatus: { $in: ["pending", "correction_requested"] }, user: { $ne: me } }
    : { approvalStatus: { $in: ["pending", "correction_requested"] }, approver: me };
  queues.push(
    queue("movement", "Movement", "movement", "/movement?tab=approvals", async () => {
      const [count, doc] = await Promise.all([Movement.countDocuments(movementFilter), Movement.findOne(movementFilter, { user: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean()]);
      return { count, oldest: doc ? { user: doc.user, at: doc.createdAt } : undefined };
    }),
  );

  if (can(user, "attendance.approve") || reports.length > 0) {
    const f: Record<string, unknown> = can(user, "attendance.approve") ? { status: "pending", user: { $ne: me } } : { status: "pending", user: { $in: reports } };
    queues.push(
      queue("attendance", "Attendance corrections", "attendance correction", "/attendance/corrections", async () => {
        const [count, doc] = await Promise.all([AttendanceCorrection.countDocuments(f), AttendanceCorrection.findOne(f, { user: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean()]);
        return { count, oldest: doc ? { user: doc.user, at: doc.createdAt } : undefined };
      }),
    );
  }

  if (can(user, "expenses.approve")) {
    const f: Record<string, unknown> = { status: "submitted", user: { $ne: me } };
    queues.push(
      queue("expenses", "Expenses", "expense claim", "/expenses", async () => {
        const [count, doc] = await Promise.all([Expense.countDocuments(f), Expense.findOne(f, { user: 1, submittedAt: 1 }).sort({ submittedAt: 1 }).lean()]);
        return { count, oldest: doc ? { user: doc.user, at: doc.submittedAt } : undefined };
      }),
    );
  }

  // Timesheets are approved per person-week, so count distinct user + week pairs.
  if (can(user, "timesheets.approve") || reports.length > 0) {
    const f: Record<string, unknown> = can(user, "timesheets.approve") ? { status: "submitted", user: { $ne: me } } : { status: "submitted", user: { $in: reports } };
    queues.push(
      queue("timesheets", "Timesheets", "timesheet", "/timesheets/approvals", async () => {
        const [counted, doc] = await Promise.all([
          TimesheetEntry.aggregate<{ n: number }>([{ $match: f }, { $group: { _id: { user: "$user", week: "$weekStart" } } }, { $count: "n" }]),
          TimesheetEntry.findOne(f, { user: 1, submittedAt: 1 }).sort({ submittedAt: 1 }).lean(),
        ]);
        return { count: counted[0]?.n ?? 0, oldest: doc ? { user: doc.user, at: doc.submittedAt } : undefined };
      }),
    );
  }

  if (can(user, "payroll.approve")) {
    queues.push(
      queue("payroll", "Payroll", "payroll run", "/payroll", async () => {
        const [count, doc] = await Promise.all([PayrollRun.countDocuments({ status: "verified" }), PayrollRun.findOne({ status: "verified" }, { verifiedAt: 1 }).sort({ verifiedAt: 1 }).lean()]);
        return { count, oldest: doc ? { at: doc.verifiedAt } : undefined };
      }),
    );
  }

  return (await Promise.all(queues)).filter((q): q is ApprovalQueue => q !== null);
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
  await connectDB();
  const { sinceMonth, today } = getPeriods();
  const lo = `${sinceMonth}-01`;
  const [invoiced, payments, expenses, open] = await Promise.all([
    Invoice.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { issueDate: { $gte: lo }, status: { $nin: ["draft", "cancelled"] } } },
      { $group: { _id: { $substrBytes: ["$issueDate", 0, 7] }, total: { $sum: "$total" }, count: { $sum: 1 } } },
    ]),
    Payment.aggregate<{ _id: { month: string; type: string }; amount: number }>([
      { $match: { date: { $gte: lo }, type: { $in: ["payment", "refund"] } } },
      { $group: { _id: { month: { $substrBytes: ["$date", 0, 7] }, type: "$type" }, amount: { $sum: "$amount" } } },
    ]),
    Expense.aggregate<{ _id: string; amount: number }>([
      { $match: { date: { $gte: lo }, status: { $in: ["approved", "paid"] } } },
      { $group: { _id: { $substrBytes: ["$date", 0, 7] }, amount: { $sum: "$amount" } } },
    ]),
    Invoice.aggregate<{ _id: null; outstanding: number; overdueCount: number; overdueAmount: number }>([
      { $match: { status: { $in: ["issued", "partially_paid", "overdue"] }, balance: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          outstanding: { $sum: "$balance" },
          overdueCount: { $sum: { $cond: [{ $lt: ["$dueDate", today] }, 1, 0] } },
          overdueAmount: { $sum: { $cond: [{ $lt: ["$dueDate", today] }, "$balance", 0] } },
        },
      },
    ]),
  ]);
  const collected = new Map<string, number>();
  for (const p of payments) collected.set(p._id.month, (collected.get(p._id.month) ?? 0) + (p._id.type === "refund" ? -Math.abs(p.amount) : p.amount));
  return {
    invoiced: new Map(invoiced.map((i) => [i._id, i.total])),
    invoiceCount: new Map(invoiced.map((i) => [i._id, i.count])),
    collected,
    expenses: new Map(expenses.map((e) => [e._id, e.amount])),
    outstanding: open[0]?.outstanding ?? 0,
    overdueCount: open[0]?.overdueCount ?? 0,
    overdueAmount: open[0]?.overdueAmount ?? 0,
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
    await connectDB();
    const { sinceMonth } = getPeriods();
    const lo = `${sinceMonth}-01`;
    const [attendance, movements, tasks] = await Promise.all([
      flags.attendance
        ? Attendance.aggregate<{ _id: string; days: number; minutes: number }>([
            { $match: { date: { $gte: lo }, checkIn: { $exists: true } } },
            { $group: { _id: { $substrBytes: ["$date", 0, 7] }, days: { $sum: 1 }, minutes: { $sum: "$workMinutes" } } },
          ])
        : [],
      flags.movements
        ? Movement.aggregate<{ _id: string; n: number }>([{ $match: { date: { $gte: lo }, status: { $in: ["out", "returned"] } } }, { $group: { _id: { $substrBytes: ["$date", 0, 7] }, n: { $sum: 1 } } }])
        : [],
      flags.tasks
        ? Task.aggregate<{ _id: string; n: number }>([
            { $match: { completedAt: { $gte: zonedDateTime(lo, "00:00") } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$completedAt", timezone: TZ } }, n: { $sum: 1 } } },
          ])
        : [],
    ]);
    return {
      attendedDays: new Map(attendance.map((a) => [a._id, a.days])),
      workMinutes: new Map(attendance.map((a) => [a._id, a.minutes])),
      movements: new Map(movements.map((m) => [m._id, m.n])),
      tasksDone: new Map(tasks.map((t) => [t._id, t.n])),
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
  project?: Types.ObjectId;
  status: string;
  priority: string;
  dueDate?: string;
  progress: number;
  submissions: { submittedBy: Types.ObjectId; reviewStatus: string; submittedAt: Date; reviewNote?: string }[];
}

/** A person's open tasks, soonest deadline first with undated tasks last. `shared` also includes tasks shared with them. */
export async function loadOpenTasks(userId: string | Types.ObjectId, closedStatuses: string[], limit: number, shared = false): Promise<{ tasks: OpenTask[]; total: number }> {
  await connectDB();
  const scope = shared ? { $or: [{ assignees: userId }, { sharedWith: userId }] } : { assignees: userId };
  // `$and` keeps the scope's own `$or` intact next to the due-date `$or` below.
  const base = { $and: [scope, { status: { $nin: closedStatuses } }] };
  const projection = { taskNo: 1, title: 1, project: 1, status: 1, priority: 1, dueDate: 1, progress: 1, submissions: 1 } as const;
  const [dated, total] = await Promise.all([
    Task.find({ $and: [...base.$and, { dueDate: { $exists: true, $nin: [null, ""] } }] }, projection).sort({ dueDate: 1 }).limit(limit).lean(),
    Task.countDocuments(base),
  ]);
  const undated =
    dated.length < limit
      ? await Task.find({ $and: [...base.$and, { $or: [{ dueDate: { $exists: false } }, { dueDate: null }, { dueDate: "" }] }] }, projection)
          .sort({ updatedAt: -1 })
          .limit(limit - dated.length)
          .lean()
      : [];
  const tasks = [...dated, ...undated].map((t) => ({
    id: t._id.toString(),
    taskNo: t.taskNo,
    title: t.title,
    project: t.project,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate || undefined,
    progress: t.progress,
    submissions: t.submissions.map((s) => ({ submittedBy: s.submittedBy, reviewStatus: s.reviewStatus, submittedAt: s.submittedAt, reviewNote: s.reviewNote })),
  }));
  return { tasks, total };
}
