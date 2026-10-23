import "server-only";
import { and, asc, eq, gte, isNull, lte, ne, or, sql, type Column, type SQL } from "drizzle-orm";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  Attendance,
  Client,
  Department,
  Designation,
  LeaveRequest,
  PERSON_TYPES,
  Project,
  User,
  type IAttendance,
  type Id,
} from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { getSettings } from "@/lib/settings";
import { workCalendar, type WorkCalendar } from "@/lib/domain/calendar";
import { inList, notInList } from "@/lib/sql";
import { addDays, diffDays, endOfDay, monthKey, startOfDay, todayKey } from "@/lib/time";
import type { ReportFilterDef, ReportFilters } from "./types";

/** Longest date range a report may cover (keeps day-by-day reports bounded). */
export const MAX_RANGE_DAYS = 400;

/* ------------------------------------------------------------------ filters */

export const DEFAULTS = {
  monthStart: () => `${monthKey()}-01`,
  today: () => todayKey(),
  thisMonth: () => monthKey(),
  sixMonthsAgo: () => {
    const [y, m] = monthKey().split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 - 5, 1)).toISOString().slice(0, 7);
  },
};

export const RANGE_FILTERS: ReportFilterDef[] = [
  { key: "from", label: "From", type: "date", defaultValue: DEFAULTS.monthStart },
  { key: "to", label: "To", type: "date", defaultValue: DEFAULTS.today },
];

export const DEPARTMENT_FILTER: ReportFilterDef = { key: "department", label: "Department", type: "department" };
export const PERSON_FILTER: ReportFilterDef = { key: "person", label: "Employee", type: "person" };

/** `from` / `to` day keys with defaults (this month to today), ordered and capped at MAX_RANGE_DAYS. */
export function rangeOf(f: ReportFilters, fromKey = "from", toKey = "to"): { from: string; to: string } {
  let from = f[fromKey] || DEFAULTS.monthStart();
  let to = f[toKey] || todayKey();
  if (from > to) [from, to] = [to, from];
  if (diffDays(from, to) > MAX_RANGE_DAYS) from = addDays(to, -MAX_RANGE_DAYS);
  return { from, to };
}

/** Instants spanning an inclusive day range in the company time zone. */
export function instantRange(from: string, to: string): { start: Date; end: Date } {
  return { start: startOfDay(from), end: endOfDay(to) };
}

/** First and last month keys of a month range (defaults: last six months). */
export function monthRangeOf(f: ReportFilters, fromKey = "from", toKey = "to"): { from: string; to: string } {
  let from = f[fromKey] || DEFAULTS.sixMonthsAgo();
  let to = f[toKey] || monthKey();
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

export function rangeLabel(from: string, to: string): string {
  return from === to ? from : `${from} to ${to}`;
}

/** Indian financial year (April to March) containing a day key. */
export function fyOf(day: string): { from: string; to: string; label: string } {
  const [y, m] = day.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}–${String(start + 1).slice(2)}` };
}

/* ------------------------------------------------------------------- people */

export interface PersonInfo {
  id: string;
  name: string;
  employeeId: string;
  personType: string;
  department: string;
  designation: string;
  status: string;
  joiningDate?: string;
}

/** One query for the people columns plus department / designation names (instead of separate name lookups). */
function personQuery() {
  return db()
    .select({
      id: User._id,
      name: User.name,
      employeeId: User.employeeId,
      personType: User.personType,
      status: User.status,
      joiningDate: User.joiningDate,
      department: Department.name,
      designation: Designation.name,
    })
    .from(User)
    .leftJoin(Department, eq(Department._id, User.department))
    .leftJoin(Designation, eq(Designation._id, User.designation));
}

type PersonRow = Awaited<ReturnType<typeof personQuery>>[number];

export async function departmentNames(): Promise<Map<string, string>> {
  const departments = await db().select({ id: Department._id, name: Department.name }).from(Department);
  return new Map(departments.map((d) => [d.id, d.name]));
}

function toPerson(u: PersonRow): PersonInfo {
  return {
    id: u.id,
    name: u.name,
    employeeId: u.employeeId,
    personType: u.personType,
    department: u.department ?? "",
    designation: u.designation ?? "",
    status: u.status,
    joiningDate: u.joiningDate ?? undefined,
  };
}

/** Lookup of people by id (name, employee id, department, designation). Missing ids are simply absent. */
export async function peopleMap(ids: Iterable<unknown>): Promise<Map<string, PersonInfo>> {
  const unique = [...new Set([...ids].filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const users = await personQuery().where(inList(User._id, unique));
  return new Map(users.map((u) => [u.id, toPerson(u)]));
}

/** Staff (employees, trainees, interns — never the super admin) matching the department / person filters. */
export async function loadStaff(f: ReportFilters, extra?: SQL): Promise<PersonInfo[]> {
  const users = await personQuery()
    .where(and(inList(User.personType, PERSON_TYPES), f.department ? eq(User.department, f.department) : undefined, f.person ? eq(User._id, f.person) : undefined, extra))
    .orderBy(asc(User.name));
  return users.map(toPerson);
}

/** Condition on a `user` column (pass e.g. `Attendance.user`) from the department / person filters (`undefined` when neither is set). */
export function userScope(f: ReportFilters, column: Column): SQL | undefined {
  if (f.person) return eq(column, f.person);
  if (f.department) {
    return sql`${column} in (select ${User._id} from ${User} where ${and(eq(User.department, f.department), inList(User.personType, PERSON_TYPES))})`;
  }
  return undefined;
}

/* --------------------------------------------------------------- attendance */

export type AttendanceRow = Pick<
  IAttendance,
  | "user"
  | "date"
  | "checkIn"
  | "checkOut"
  | "workMinutes"
  | "breakMinutes"
  | "movementMinutes"
  | "status"
  | "late"
  | "lateMinutes"
  | "earlyDeparture"
  | "earlyMinutes"
  | "missingCheckout"
  | "source"
  | "remarks"
>;

export interface AttendanceContext {
  settings: AppSettings;
  cal: WorkCalendar;
  att: Map<string, AttendanceRow>;
  attendanceOf(userId: string, day: string): AttendanceRow | undefined;
  /** Approved leave covering a day: full day, half day or none. */
  leaveOn(userId: string, day: string): "full" | "half" | null;
}

/** Attendance records, approved leave and the work calendar for a set of people over a day range. */
export async function loadAttendance(userIds: string[], from: string, to: string): Promise<AttendanceContext> {
  const settings = await getSettings();
  const [cal, docs, leaves] = await Promise.all([
    workCalendar(settings, from, to),
    userIds.length
      ? db()
          .select({
            user: Attendance.user,
            date: Attendance.date,
            checkIn: Attendance.checkIn,
            checkOut: Attendance.checkOut,
            workMinutes: Attendance.workMinutes,
            breakMinutes: Attendance.breakMinutes,
            movementMinutes: Attendance.movementMinutes,
            status: Attendance.status,
            late: Attendance.late,
            lateMinutes: Attendance.lateMinutes,
            earlyDeparture: Attendance.earlyDeparture,
            earlyMinutes: Attendance.earlyMinutes,
            missingCheckout: Attendance.missingCheckout,
            source: Attendance.source,
            remarks: Attendance.remarks,
          })
          .from(Attendance)
          .where(and(inList(Attendance.user, userIds), gte(Attendance.date, from), lte(Attendance.date, to)))
      : [],
    userIds.length
      ? db()
          .select({ user: LeaveRequest.user, startDate: LeaveRequest.startDate, endDate: LeaveRequest.endDate, halfDay: LeaveRequest.halfDay })
          .from(LeaveRequest)
          .where(and(inList(LeaveRequest.user, userIds), eq(LeaveRequest.status, "approved"), lte(LeaveRequest.startDate, to), gte(LeaveRequest.endDate, from)))
      : [],
  ]);
  const att = new Map<string, AttendanceRow>(docs.map((d) => [`${d.user}|${d.date}`, d]));
  const leaveByUser = new Map<string, { start: string; end: string; half: boolean }[]>();
  for (const l of leaves) {
    const list = leaveByUser.get(l.user) ?? [];
    list.push({ start: l.startDate, end: l.endDate, half: l.halfDay });
    leaveByUser.set(l.user, list);
  }
  return {
    settings,
    cal,
    att,
    attendanceOf: (userId, day) => att.get(`${userId}|${day}`),
    leaveOn: (userId, day) => {
      let result: "full" | "half" | null = null;
      for (const l of leaveByUser.get(userId) ?? []) {
        if (day >= l.start && day <= l.end) {
          if (!l.half) return "full";
          result = "half";
        }
      }
      return result;
    },
  };
}

/* -------------------------------------------------------- confidential data */

/** Ids of restricted clients the user may not see (restricted = `confidential` unless owner / `crm.confidential`). */
export async function hiddenClientIds(user: CurrentUser): Promise<Id[]> {
  if (can(user, "crm.confidential")) return [];
  const rows = await db()
    .select({ id: Client._id })
    .from(Client)
    .where(and(eq(Client.confidential, true), or(isNull(Client.owner), ne(Client.owner, user._id))));
  return rows.map((r) => r.id);
}

/** Client names for display; restricted clients the user cannot see appear as "Restricted client". */
export async function clientNames(ids: Iterable<unknown>, user: CurrentUser): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await db().select({ id: Client._id, name: Client.name, confidential: Client.confidential, owner: Client.owner }).from(Client).where(inList(Client._id, unique));
  const seeRestricted = can(user, "crm.confidential");
  // Same rule as `hiddenClientIds`: restricted unless the viewer holds `crm.confidential` or owns the client.
  return new Map(rows.map((c) => [c.id, !seeRestricted && c.confidential && c.owner !== user._id ? "Restricted client" : c.name]));
}

export interface ProjectInfo {
  id: string;
  projectNo: string;
  title: string;
  client?: string;
  manager?: string;
}

export async function projectMap(ids: Iterable<unknown>): Promise<Map<string, ProjectInfo>> {
  const unique = [...new Set([...ids].filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await db()
    .select({ id: Project._id, projectNo: Project.projectNo, title: Project.title, client: Project.client, manager: Project.manager })
    .from(Project)
    .where(inList(Project._id, unique));
  return new Map(rows.map((p) => [p.id, { id: p.id, projectNo: p.projectNo, title: p.title, client: p.client ?? undefined, manager: p.manager ?? undefined }]));
}

/* ------------------------------------------------------------- aggregation */

/** `coalesce(sum(expr), 0)` as a number (Mongo's `$sum` of nothing is 0; SQL's is NULL). */
export function sumOf(expr: Column | SQL) {
  return sql<number>`coalesce(sum(${expr}), 0)`.mapWith(Number);
}

/* ----------------------------------------------------------------- formatting */

export const yesNo = (v: boolean) => (v ? "Yes" : "No");

/** Minutes as decimal hours rounded to two places. */
export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** Joins non-empty parts with a separator. */
export function joinParts(parts: (string | null | undefined | false)[], sep = " · "): string {
  return parts.filter(Boolean).join(sep);
}

/**
 * Condition on a client reference column (pass e.g. `Invoice.client`) that honours the `client` filter and hides
 * restricted clients the viewer may not see (pass the result of `hiddenClientIds`). `undefined` means no restriction.
 */
export function clientScope(f: ReportFilters, hidden: Id[], column: Column): SQL | undefined {
  if (f.client) return hidden.includes(f.client) ? inList(column, []) : eq(column, f.client);
  return hidden.length ? notInList(column, hidden) : undefined;
}
