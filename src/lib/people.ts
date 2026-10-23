import "server-only";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { Department, Designation, User, type Id } from "@/lib/models";
import { inList, jsonPath, notInList } from "@/lib/sql";

export interface PersonOption {
  id: string;
  name: string;
  employeeId: string;
  personType: string;
  designation?: string;
  department?: string;
  photo?: string;
}

const EXITED = ["resigned", "terminated", "inactive"];

/**
 * Lightweight list of people for pickers (assignees, approvers, owners). Contains no
 * confidential data, so it is safe for any signed-in user.
 */
export async function peopleOptions(opts: { includeExited?: boolean; personTypes?: string[] } = {}): Promise<PersonOption[]> {
  const rows = await db()
    .select({
      id: User._id,
      name: User.name,
      employeeId: User.employeeId,
      personType: User.personType,
      photo: User.photo,
      designation: Designation.name,
      department: Department.name,
    })
    .from(User)
    .leftJoin(Designation, eq(Designation._id, User.designation))
    .leftJoin(Department, eq(Department._id, User.department))
    .where(
      and(
        inList(User.personType, opts.personTypes ?? ["employee", "trainee", "intern"]),
        opts.includeExited ? undefined : notInList(User.status, EXITED),
      ),
    )
    .orderBy(asc(User.name));
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    employeeId: u.employeeId,
    personType: u.personType,
    designation: u.designation ?? undefined,
    department: u.department ?? undefined,
    photo: u.photo ?? undefined,
  }));
}

/** Ids of people who report directly to `managerId`. */
export async function directReportIds(managerId: Id): Promise<string[]> {
  const rows = await db().select({ id: User._id }).from(User).where(eq(User.reportingManager, managerId));
  return rows.map((r) => r.id);
}

/** Ids of interns / trainees mentored by `mentorId`. */
export async function menteeIds(mentorId: Id): Promise<string[]> {
  const rows = await db().select({ id: User._id }).from(User).where(eq(jsonPath(User.internship, "mentor"), mentorId));
  return rows.map((r) => r.id);
}

export async function isManagerOf(managerId: string, userId: Id): Promise<boolean> {
  const [u] = await db()
    .select({ id: User._id })
    .from(User)
    .where(and(eq(User._id, userId), or(eq(User.reportingManager, managerId), eq(jsonPath(User.internship, "mentor"), managerId))))
    .limit(1);
  return Boolean(u);
}

/** Map of userId → display name for a set of ids. */
export async function namesFor(ids: (Id | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is Id => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const users = await db().select({ id: User._id, name: User.name }).from(User).where(inList(User._id, unique));
  return new Map(users.map((u) => [u.id, u.name]));
}

export const EXITED_STATUSES = EXITED;
