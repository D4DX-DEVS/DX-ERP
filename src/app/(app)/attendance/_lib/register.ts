import "server-only";
import { and, asc, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { workCalendar } from "@/lib/domain/calendar";
import { Attendance, Department, Designation, Holiday, LeaveRequest, Movement, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { inList, notInList, searchAny } from "@/lib/sql";
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
  const settings = await getSettings();
  const now = new Date();
  const today = todayKey();
  const { date } = opts;
  const isToday = date === today;

  const dayRecords = await db()
    .select({
      _id: Attendance._id,
      user: Attendance.user,
      checkIn: Attendance.checkIn,
      checkOut: Attendance.checkOut,
      breaks: Attendance.breaks,
      breakMinutes: Attendance.breakMinutes,
      workMinutes: Attendance.workMinutes,
      status: Attendance.status,
      late: Attendance.late,
      lateMinutes: Attendance.lateMinutes,
      earlyDeparture: Attendance.earlyDeparture,
      earlyMinutes: Attendance.earlyMinutes,
    })
    .from(Attendance)
    .where(and(eq(Attendance.date, date), access.viewAll ? undefined : inList(Attendance.user, access.reportIds)));
  const recordedIds = dayRecords.map((a) => a.user);

  const [users, departments, designations, [holiday]] = await Promise.all([
    db()
      .select({
        _id: User._id,
        name: User.name,
        employeeId: User.employeeId,
        photo: User.photo,
        personType: User.personType,
        department: User.department,
        designation: User.designation,
      })
      .from(User)
      .where(
        and(
          access.viewAll ? undefined : inList(User._id, access.reportIds),
          inList(User.personType, STAFF_TYPES),
          or(notInList(User.status, EXITED_STATUSES), inList(User._id, recordedIds)),
          or(isNull(User.joiningDate), lte(User.joiningDate, date), inList(User._id, recordedIds)),
          opts.q ? searchAny(opts.q, User.name, User.employeeId) : undefined,
          opts.dept ? eq(User.department, opts.dept) : undefined,
        ),
      )
      .orderBy(asc(User.name)),
    db().select({ _id: Department._id, name: Department.name }).from(Department).orderBy(asc(Department.name)),
    db().select({ _id: Designation._id, name: Designation.name }).from(Designation),
    db().select({ name: Holiday.name }).from(Holiday).where(and(eq(Holiday.date, date), eq(Holiday.optional, false))).limit(1),
  ]);
  const ids = users.map((u) => u._id);

  const [movements, leaves] = await Promise.all([
    db()
      .select({
        _id: Movement._id,
        user: Movement.user,
        date: Movement.date,
        status: Movement.status,
        durationMinutes: Movement.durationMinutes,
        official: Movement.official,
        outTime: Movement.outTime,
        expectedReturn: Movement.expectedReturn,
        categoryLabel: Movement.categoryLabel,
      })
      .from(Movement)
      .where(
        and(
          inList(Movement.user, ids),
          inList(Movement.status, ["out", "returned"]),
          ne(Movement.approvalStatus, "rejected"),
          or(eq(Movement.date, date), isToday ? eq(Movement.status, "out") : undefined),
        ),
      ),
    db()
      .select({
        _id: LeaveRequest._id,
        user: LeaveRequest.user,
        halfDay: LeaveRequest.halfDay,
        leaveTypeName: LeaveRequest.leaveTypeName,
        startDate: LeaveRequest.startDate,
        endDate: LeaveRequest.endDate,
      })
      .from(LeaveRequest)
      .where(and(inList(LeaveRequest.user, ids), eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, date), gte(LeaveRequest.endDate, date))),
  ]);

  const cal = await workCalendar(settings, date, date);
  const leaveMap = buildLeaveDayMap(leaves, settings, cal, date, date);
  const deptName = new Map(departments.map((d) => [d._id, d.name]));
  const desigName = new Map(designations.map((d) => [d._id, d.name]));
  const attByUser = new Map(dayRecords.map((a) => [a.user, a]));
  const movesByUser = new Map<string, typeof movements>();
  for (const m of movements) {
    const k = m.user;
    movesByUser.set(k, [...(movesByUser.get(k) ?? []), m]);
  }

  const rows: RegisterRow[] = users.map((u) => {
    const id = u._id;
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
      photo: u.photo ?? undefined,
      personType: u.personType,
      department: u.department ? deptName.get(u.department) : undefined,
      designation: u.designation ? desigName.get(u.designation) : undefined,
      key: cls.key,
      extras: cls.extras,
      attendanceId: att?._id,
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
              id: open._id,
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
    departments: departments.map((d) => ({ id: d._id, name: d.name })),
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
  const settings = await getSettings();
  const now = new Date();
  const today = todayKey();
  const { from, to } = monthRange(opts.month);
  const last = to < today ? to : today;

  const [users, departments] = await Promise.all([
    db()
      .select({
        _id: User._id,
        name: User.name,
        employeeId: User.employeeId,
        personType: User.personType,
        department: User.department,
        joiningDate: User.joiningDate,
      })
      .from(User)
      .where(
        and(
          access.viewAll ? undefined : inList(User._id, access.reportIds),
          inList(User.personType, STAFF_TYPES),
          notInList(User.status, EXITED_STATUSES),
          or(isNull(User.joiningDate), lte(User.joiningDate, to)),
          opts.q ? searchAny(opts.q, User.name, User.employeeId) : undefined,
          opts.dept ? eq(User.department, opts.dept) : undefined,
        ),
      )
      .orderBy(asc(User.name)),
    db().select({ _id: Department._id, name: Department.name }).from(Department).orderBy(asc(Department.name)),
  ]);
  const ids = users.map((u) => u._id);
  if (from > last) return { rows: users.map((u) => ({ userId: u._id, name: u.name, employeeId: u.employeeId, personType: u.personType, summary: summarizeDays([]) })), departments: departments.map((d) => ({ id: d._id, name: d.name })) };

  const [records, leaves, cal] = await Promise.all([
    db()
      .select({
        user: Attendance.user,
        date: Attendance.date,
        status: Attendance.status,
        late: Attendance.late,
        earlyDeparture: Attendance.earlyDeparture,
        checkIn: Attendance.checkIn,
        checkOut: Attendance.checkOut,
        workMinutes: Attendance.workMinutes,
      })
      .from(Attendance)
      .where(and(inList(Attendance.user, ids), gte(Attendance.date, from), lte(Attendance.date, last))),
    db()
      .select({
        _id: LeaveRequest._id,
        user: LeaveRequest.user,
        startDate: LeaveRequest.startDate,
        endDate: LeaveRequest.endDate,
        halfDay: LeaveRequest.halfDay,
        leaveTypeName: LeaveRequest.leaveTypeName,
      })
      .from(LeaveRequest)
      .where(and(inList(LeaveRequest.user, ids), eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, last), gte(LeaveRequest.endDate, from))),
    workCalendar(settings, from, last),
  ]);
  const leaveMap = buildLeaveDayMap(leaves, settings, cal, from, last);
  const recByUser = new Map<string, Map<string, (typeof records)[number]>>();
  for (const r of records) {
    const k = r.user;
    const m = recByUser.get(k) ?? new Map();
    m.set(r.date, r);
    recByUser.set(k, m);
  }
  const deptName = new Map(departments.map((d) => [d._id, d.name]));

  const rows: SummaryRow[] = users.map((u) => {
    const id = u._id;
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
      department: u.department ? deptName.get(u.department) : undefined,
      summary: summarizeDays(days),
    };
  });
  return { rows, departments: departments.map((d) => ({ id: d._id, name: d.name })) };
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
