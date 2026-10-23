import "server-only";
import { Types } from "mongoose";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
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
} from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { getSettings } from "@/lib/settings";
import { workCalendar, type WorkCalendar } from "@/lib/domain/calendar";
import { addDays, diffDays, endOfDay, monthKey, startOfDay, todayKey } from "@/lib/time";
import type { ReportFilterDef, ReportFilters } from "./types";

/** Longest date range a report may cover (keeps day-by-day reports bounded). */
export const MAX_RANGE_DAYS = 400;

export const oid = (id: string) => new Types.ObjectId(id);

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

const PERSON_PROJECTION = { name: 1, employeeId: 1, personType: 1, department: 1, designation: 1, status: 1, joiningDate: 1 } as const;

async function nameMaps(): Promise<{ departments: Map<string, string>; designations: Map<string, string> }> {
  const [departments, designations] = await Promise.all([Department.find({}, { name: 1 }).lean(), Designation.find({}, { name: 1 }).lean()]);
  return {
    departments: new Map(departments.map((d) => [d._id.toString(), d.name])),
    designations: new Map(designations.map((d) => [d._id.toString(), d.name])),
  };
}

export async function departmentNames(): Promise<Map<string, string>> {
  await connectDB();
  return (await nameMaps()).departments;
}

type PersonDoc = {
  _id: Types.ObjectId;
  name: string;
  employeeId: string;
  personType: string;
  department?: Types.ObjectId;
  designation?: Types.ObjectId;
  status: string;
  joiningDate?: string;
};

function toPerson(u: PersonDoc, maps: { departments: Map<string, string>; designations: Map<string, string> }): PersonInfo {
  return {
    id: u._id.toString(),
    name: u.name,
    employeeId: u.employeeId,
    personType: u.personType,
    department: u.department ? (maps.departments.get(u.department.toString()) ?? "") : "",
    designation: u.designation ? (maps.designations.get(u.designation.toString()) ?? "") : "",
    status: u.status,
    joiningDate: u.joiningDate,
  };
}

/** Lookup of people by id (name, employee id, department, designation). Missing ids are simply absent. */
export async function peopleMap(ids: Iterable<unknown>): Promise<Map<string, PersonInfo>> {
  const unique = [...new Set([...ids].filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  await connectDB();
  const [users, maps] = await Promise.all([User.find({ _id: { $in: unique } }, PERSON_PROJECTION).lean(), nameMaps()]);
  return new Map(users.map((u) => [u._id.toString(), toPerson(u, maps)]));
}

/** Staff (employees, trainees, interns — never the super admin) matching the department / person filters. */
export async function loadStaff(f: ReportFilters, extra: Record<string, unknown> = {}): Promise<PersonInfo[]> {
  await connectDB();
  const filter: Record<string, unknown> = { personType: { $in: PERSON_TYPES }, ...extra };
  if (f.department) filter.department = f.department;
  if (f.person) filter._id = f.person;
  const [users, maps] = await Promise.all([User.find(filter, PERSON_PROJECTION).sort({ name: 1 }).lean(), nameMaps()]);
  return users.map((u) => toPerson(u, maps));
}

/** Mongo filter on a `user` field from the department / person filters (empty when neither is set). */
export async function userScope(f: ReportFilters, field = "user"): Promise<Record<string, unknown>> {
  if (f.person) return { [field]: f.person };
  if (f.department) {
    await connectDB();
    const ids = await User.distinct("_id", { department: f.department, personType: { $in: PERSON_TYPES } });
    return { [field]: { $in: ids } };
  }
  return {};
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
  await connectDB();
  const settings = await getSettings();
  const [cal, docs, leaves] = await Promise.all([
    workCalendar(settings, from, to),
    userIds.length
      ? Attendance.find(
          { user: { $in: userIds }, date: { $gte: from, $lte: to } },
          {
            user: 1,
            date: 1,
            checkIn: 1,
            checkOut: 1,
            workMinutes: 1,
            breakMinutes: 1,
            movementMinutes: 1,
            status: 1,
            late: 1,
            lateMinutes: 1,
            earlyDeparture: 1,
            earlyMinutes: 1,
            missingCheckout: 1,
            source: 1,
            remarks: 1,
          },
        ).lean()
      : [],
    userIds.length
      ? LeaveRequest.find({ user: { $in: userIds }, status: "approved", startDate: { $lte: to }, endDate: { $gte: from } }, { user: 1, startDate: 1, endDate: 1, halfDay: 1 }).lean()
      : [],
  ]);
  const att = new Map<string, AttendanceRow>(docs.map((d) => [`${d.user.toString()}|${d.date}`, d]));
  const leaveByUser = new Map<string, { start: string; end: string; half: boolean }[]>();
  for (const l of leaves) {
    const key = l.user.toString();
    const list = leaveByUser.get(key) ?? [];
    list.push({ start: l.startDate, end: l.endDate, half: l.halfDay });
    leaveByUser.set(key, list);
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
export async function hiddenClientIds(user: CurrentUser): Promise<Types.ObjectId[]> {
  if (can(user, "crm.confidential")) return [];
  await connectDB();
  const rows = await Client.find({ confidential: true, owner: { $ne: user._id } }, { _id: 1 }).lean();
  return rows.map((r) => r._id);
}

/** Client names for display; restricted clients the user cannot see appear as "Restricted client". */
export async function clientNames(ids: Iterable<unknown>, user: CurrentUser): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  await connectDB();
  const [rows, hidden] = await Promise.all([Client.find({ _id: { $in: unique } }, { name: 1 }).lean(), hiddenClientIds(user)]);
  const hide = new Set(hidden.map(String));
  return new Map(rows.map((c) => [c._id.toString(), hide.has(c._id.toString()) ? "Restricted client" : c.name]));
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
  await connectDB();
  const rows = await Project.find({ _id: { $in: unique } }, { projectNo: 1, title: 1, client: 1, manager: 1 }).lean();
  return new Map(
    rows.map((p) => [p._id.toString(), { id: p._id.toString(), projectNo: p.projectNo, title: p.title, client: p.client?.toString(), manager: p.manager?.toString() }]),
  );
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
 * Mongo condition on a client reference that honours the `client` filter and hides restricted
 * clients the viewer may not see (pass the result of `hiddenClientIds`).
 */
export function clientScope(f: ReportFilters, hidden: Types.ObjectId[], field = "client"): Record<string, unknown> {
  if (f.client) return hidden.some((h) => h.toString() === f.client) ? { [field]: { $in: [] } } : { [field]: f.client };
  return hidden.length ? { [field]: { $nin: hidden } } : {};
}
