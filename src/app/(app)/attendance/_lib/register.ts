import "server-only";
import { connectDB } from "@/lib/db";
import { workCalendar } from "@/lib/domain/calendar";
import { Attendance, Department, Designation, Holiday, LeaveRequest, Movement, User } from "@/lib/models";
import { searchRegex } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { eachDay, fmtDate, monthRange, todayKey } from "@/lib/time";
import type { AttendanceAccess } from "./access";
import { EXITED_STATUSES, STAFF_TYPES } from "./access";
import { classifyDay, dayChipInfo, isAttended, provisionalWork, summarizeDays, type DayKey, type DaySummary } from "./day";
import { buildLeaveDayMap } from "./leave-days";

/* ------------------------------------------------------------------ */
/* Daily register                                                      */
/* ------------------------------------------------------------------ */

export interface RegisterRow {
  userId: string;
  name: string;
  employeeId: string;
  photo?: string;
  personType: string;
  department?: string;
  designation?: string;
  key: DayKey;
  extras: DayKey[];
  attendanceId?: string;
  checkIn?: Date;
  checkOut?: Date;
  breakMinutes: number;
  /** null when the day is open and not today (hours stay provisional). */
  workMinutes: number | null;
  lateMinutes: number;
  earlyMinutes: number;
  movementCount: number;
  movementMinutes: number;
  /** Open movement ("out"): only when viewing today. */
  outside?: { id: string; since: Date; label: string; overdue: boolean; fromEarlierDay: boolean };
  note?: string;
}

export interface Register {
  date: string;
  isToday: boolean;
  holidayName?: string;
  rows: RegisterRow[];
  departments: { id: string; name: string }[];
}

export async function loadRegister(access: AttendanceAccess, opts: { date: string; q?: string; dept?: string }): Promise<Register> {
  await connectDB();
  const settings = await getSettings();
  const now = new Date();
  const today = todayKey();
  const { date } = opts;
  const isToday = date === today;

  const scope: Record<string, unknown> = access.viewAll ? {} : { _id: { $in: access.reportIds } };
  const dayRecords = await Attendance.find({ date, ...(access.viewAll ? {} : { user: { $in: access.reportIds } }) }).lean();
  const recordedIds = dayRecords.map((a) => a.user);

  const and: Record<string, unknown>[] = [
    { $or: [{ status: { $nin: EXITED_STATUSES } }, { _id: { $in: recordedIds } }] },
    { $or: [{ joiningDate: null }, { joiningDate: { $lte: date } }, { _id: { $in: recordedIds } }] },
  ];
  const rx = opts.q ? searchRegex(opts.q) : undefined;
  if (rx) and.push({ $or: [{ name: rx }, { employeeId: rx }] });
  const userFilter: Record<string, unknown> = { ...scope, personType: { $in: STAFF_TYPES }, $and: and };
  if (opts.dept) userFilter.department = opts.dept;

  const [users, departments, designations, holiday] = await Promise.all([
    User.find(userFilter, { name: 1, employeeId: 1, photo: 1, personType: 1, department: 1, designation: 1 }).sort({ name: 1 }).lean(),
    Department.find({}, { name: 1 }).sort({ name: 1 }).lean(),
    Designation.find({}, { name: 1 }).lean(),
    Holiday.findOne({ date, optional: false }, { name: 1 }).lean(),
  ]);
  const ids = users.map((u) => u._id);

  const movementDay: Record<string, unknown>[] = [{ date }];
  if (isToday) movementDay.push({ status: "out" });
  const movementFilter: Record<string, unknown> = { user: { $in: ids }, status: { $in: ["out", "returned"] }, approvalStatus: { $ne: "rejected" }, $or: movementDay };
  const [movements, leaves] = await Promise.all([
    Movement.find(movementFilter, { user: 1, date: 1, status: 1, durationMinutes: 1, official: 1, outTime: 1, expectedReturn: 1, categoryLabel: 1 }).lean(),
    LeaveRequest.find(
      { user: { $in: ids }, status: "approved", startDate: { $lte: date }, endDate: { $gte: date } },
      { user: 1, halfDay: 1, leaveTypeName: 1, startDate: 1, endDate: 1 },
    ).lean(),
  ]);

  const cal = await workCalendar(settings, date, date);
  const leaveMap = buildLeaveDayMap(leaves, settings, cal, date, date);
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const desigName = new Map(designations.map((d) => [d._id.toString(), d.name]));
  const attByUser = new Map(dayRecords.map((a) => [a.user.toString(), a]));
  const movesByUser = new Map<string, typeof movements>();
  for (const m of movements) {
    const k = m.user.toString();
    movesByUser.set(k, [...(movesByUser.get(k) ?? []), m]);
  }

  const rows: RegisterRow[] = users.map((u) => {
    const id = u._id.toString();
    const att = attByUser.get(id);
    const leaveInfo = leaveMap.get(id)?.get(date);
    const cls = classifyDay({ date, today, now, att, leave: leaveInfo ? (leaveInfo.half ? "half" : "full") : null, holiday: Boolean(holiday), settings });
    const userMoves = movesByUser.get(id) ?? [];
    const dayMoves = userMoves.filter((m) => m.date === date);
    const open = userMoves.filter((m) => m.status === "out" && m.outTime).sort((a, b) => (b.outTime?.getTime() ?? 0) - (a.outTime?.getTime() ?? 0))[0];

    let workMinutes: number | null = null;
    if (att?.checkIn) {
      if (att.checkOut) workMinutes = att.workMinutes;
      else if (isToday && cls.key === "in_progress") workMinutes = provisionalWork({ date, checkIn: att.checkIn, checkOut: null, breaks: att.breaks }, dayMoves, settings, now);
    }

    const note = leaveInfo ? `${leaveInfo.typeName}${leaveInfo.half ? " · half day" : leaveInfo.endDate > date ? ` · till ${fmtDate(leaveInfo.endDate, "d MMM")}` : ""}` : undefined;
    return {
      userId: id,
      name: u.name,
      employeeId: u.employeeId,
      photo: u.photo,
      personType: u.personType,
      department: u.department ? deptName.get(u.department.toString()) : undefined,
      designation: u.designation ? desigName.get(u.designation.toString()) : undefined,
      key: cls.key,
      extras: cls.extras,
      attendanceId: att?._id.toString(),
      checkIn: att?.checkIn ?? undefined,
      checkOut: att?.checkOut ?? undefined,
      breakMinutes: att?.breakMinutes ?? 0,
      workMinutes,
      lateMinutes: att?.lateMinutes ?? 0,
      earlyMinutes: att?.earlyMinutes ?? 0,
      movementCount: dayMoves.length,
      movementMinutes: dayMoves.filter((m) => m.status === "returned").reduce((s, m) => s + (m.durationMinutes ?? 0), 0),
      outside:
        isToday && open?.outTime
          ? {
              id: open._id.toString(),
              since: open.outTime,
              label: open.official ? open.categoryLabel : "Out",
              overdue: Boolean(open.expectedReturn && now.getTime() > open.expectedReturn.getTime() + settings.movement.overdueGraceMinutes * 60_000),
              fromEarlierDay: open.date < date,
            }
          : undefined,
      note,
    };
  });

  return {
    date,
    isToday,
    holidayName: holiday?.name,
    rows,
    departments: departments.map((d) => ({ id: d._id.toString(), name: d.name })),
  };
}

/* ------------------------------------------------------------------ */
/* Monthly summary                                                     */
/* ------------------------------------------------------------------ */

export interface SummaryRow {
  userId: string;
  name: string;
  employeeId: string;
  personType: string;
  department?: string;
  summary: DaySummary;
}

export async function loadSummary(access: AttendanceAccess, opts: { month: string; q?: string; dept?: string }): Promise<{ rows: SummaryRow[]; departments: { id: string; name: string }[] }> {
  await connectDB();
  const settings = await getSettings();
  const now = new Date();
  const today = todayKey();
  const { from, to } = monthRange(opts.month);
  const last = to < today ? to : today;

  const and: Record<string, unknown>[] = [{ $or: [{ joiningDate: null }, { joiningDate: { $lte: to } }] }];
  const rx = opts.q ? searchRegex(opts.q) : undefined;
  if (rx) and.push({ $or: [{ name: rx }, { employeeId: rx }] });
  const userFilter: Record<string, unknown> = {
    ...(access.viewAll ? {} : { _id: { $in: access.reportIds } }),
    personType: { $in: STAFF_TYPES },
    status: { $nin: EXITED_STATUSES },
    $and: and,
  };
  if (opts.dept) userFilter.department = opts.dept;

  const [users, departments] = await Promise.all([
    User.find(userFilter, { name: 1, employeeId: 1, personType: 1, department: 1, joiningDate: 1 }).sort({ name: 1 }).lean(),
    Department.find({}, { name: 1 }).sort({ name: 1 }).lean(),
  ]);
  const ids = users.map((u) => u._id);
  if (from > last) return { rows: users.map((u) => ({ userId: u._id.toString(), name: u.name, employeeId: u.employeeId, personType: u.personType, summary: summarizeDays([]) })), departments: departments.map((d) => ({ id: d._id.toString(), name: d.name })) };

  const [records, leaves, cal] = await Promise.all([
    Attendance.find({ user: { $in: ids }, date: { $gte: from, $lte: last } }).lean(),
    LeaveRequest.find({ user: { $in: ids }, status: "approved", startDate: { $lte: last }, endDate: { $gte: from } }, { user: 1, startDate: 1, endDate: 1, halfDay: 1, leaveTypeName: 1 }).lean(),
    workCalendar(settings, from, last),
  ]);
  const leaveMap = buildLeaveDayMap(leaves, settings, cal, from, last);
  const recByUser = new Map<string, Map<string, (typeof records)[number]>>();
  for (const r of records) {
    const k = r.user.toString();
    const m = recByUser.get(k) ?? new Map();
    m.set(r.date, r);
    recByUser.set(k, m);
  }
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));

  const rows: SummaryRow[] = users.map((u) => {
    const id = u._id.toString();
    const recs = recByUser.get(id);
    const lv = leaveMap.get(id);
    const days = eachDay(from, last)
      .filter((d) => !u.joiningDate || d >= u.joiningDate)
      .map((date) => {
        const att = recs?.get(date);
        const l = lv?.get(date);
        const cls = classifyDay({ date, today, now, att, leave: l ? (l.half ? "half" : "full") : null, holiday: cal.isHoliday(date), settings });
        return { key: cls.key, att };
      });
    return {
      userId: id,
      name: u.name,
      employeeId: u.employeeId,
      personType: u.personType,
      department: u.department ? deptName.get(u.department.toString()) : undefined,
      summary: summarizeDays(days),
    };
  });
  return { rows, departments: departments.map((d) => ({ id: d._id.toString(), name: d.name })) };
}

/* ------------------------------------------------------------------ */
/* Register filtering / presentation helpers                           */
/* ------------------------------------------------------------------ */

export const REGISTER_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "half_day", label: "Half day" },
  { value: "early", label: "Early departure" },
  { value: "absent", label: "Absent" },
  { value: "on_leave", label: "On leave" },
  { value: "outside", label: "Outside now" },
  { value: "missing_checkout", label: "Missing check-out" },
  { value: "not_checked_in", label: "Not checked in" },
];

export function isLate(row: RegisterRow): boolean {
  return row.key === "late" || row.extras.includes("late");
}

export function isEarly(row: RegisterRow): boolean {
  return row.key === "early" || row.extras.includes("early");
}

export function isPresent(row: RegisterRow): boolean {
  return isAttended(row.key) || row.key === "half_day";
}

export function matchesStatus(row: RegisterRow, status: string): boolean {
  switch (status) {
    case "present":
      return isPresent(row);
    case "late":
      return isLate(row);
    case "early":
      return isEarly(row);
    case "on_leave":
      return row.key === "on_leave" || row.key === "half_leave";
    case "outside":
      return Boolean(row.outside);
    case "":
      return true;
    default:
      return row.key === status;
  }
}

/** Plain-text status for exports, e.g. "Late, Early departure". */
export function rowStatusText(row: RegisterRow): string {
  return [row.key, ...row.extras].map((k) => dayChipInfo(k).label).join(", ");
}
