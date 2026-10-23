import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Department, Designation, User } from "@/lib/models";

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
  await connectDB();
  const filter: Record<string, unknown> = { personType: { $in: opts.personTypes ?? ["employee", "trainee", "intern"] } };
  if (!opts.includeExited) filter.status = { $nin: EXITED };
  const [users, designations, departments] = await Promise.all([
    User.find(filter, { name: 1, employeeId: 1, personType: 1, designation: 1, department: 1, photo: 1 }).sort({ name: 1 }).lean(),
    Designation.find({}, { name: 1 }).lean(),
    Department.find({}, { name: 1 }).lean(),
  ]);
  const desig = new Map(designations.map((d) => [d._id.toString(), d.name]));
  const dept = new Map(departments.map((d) => [d._id.toString(), d.name]));
  return users.map((u) => ({
    id: u._id.toString(),
    name: u.name,
    employeeId: u.employeeId,
    personType: u.personType,
    designation: u.designation ? desig.get(u.designation.toString()) : undefined,
    department: u.department ? dept.get(u.department.toString()) : undefined,
    photo: u.photo,
  }));
}

/** Ids of people who report directly to `managerId`. */
export async function directReportIds(managerId: string | Types.ObjectId): Promise<string[]> {
  await connectDB();
  const rows = await User.find({ reportingManager: managerId }, { _id: 1 }).lean();
  return rows.map((r) => r._id.toString());
}

/** Ids of interns / trainees mentored by `mentorId`. */
export async function menteeIds(mentorId: string | Types.ObjectId): Promise<string[]> {
  await connectDB();
  const rows = await User.find({ "internship.mentor": mentorId }, { _id: 1 }).lean();
  return rows.map((r) => r._id.toString());
}

export async function isManagerOf(managerId: string, userId: string | Types.ObjectId): Promise<boolean> {
  await connectDB();
  const u = await User.findById(userId, { reportingManager: 1, "internship.mentor": 1 }).lean();
  return Boolean(u && (u.reportingManager?.toString() === managerId || u.internship?.mentor?.toString() === managerId));
}

/** Map of userId → display name for a set of ids. */
export async function namesFor(ids: (string | Types.ObjectId | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  await connectDB();
  const users = await User.find({ _id: { $in: unique } }, { name: 1 }).lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

export const EXITED_STATUSES = EXITED;
