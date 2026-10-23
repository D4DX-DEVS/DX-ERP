import "server-only";
import type { Types } from "mongoose";
import { z } from "zod";
import { ActionError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/session";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { connectDB } from "@/lib/db";
import { env } from "@/lib/env";
import { escapeRegex } from "@/lib/format";
import { Department, Designation, Role, StoredFile, User, type LifecycleEvent, type LifecycleType, type MoneyLine, type SalaryStructure } from "@/lib/models";
import { notify } from "@/lib/notify";
import { assignableRoles } from "@/lib/rbac/roles";
import { getSettings } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { zs } from "@/lib/validation";
import { AUTO_ONBOARDING_KEY, DEFAULT_EMPLOYMENT_TYPE, EMPLOYMENT_TYPE_KEYS, ONBOARDING_STEPS, type NewPersonType } from "./constants";
import { missingRequired } from "./documents";

const EXITED = ["resigned", "terminated", "inactive"];

/** The reserved super admin email (never usable by a staff record). Null when the env var is unset. */
export function superAdminEmail(): string | null {
  try {
    return env.superAdmin.email;
  } catch {
    return null;
  }
}

export function emailRegex(email: string): RegExp {
  return new RegExp(`^${escapeRegex(email.trim())}$`, "i");
}

/**
 * Roles the actor may assign. The super admin may assign any role except super_admin; a delegated
 * `users.manage` admin only roles whose permissions they hold themselves (the same ceiling as
 * `changeRole`); everyone else (e.g. HR creating people) is limited to roles that carry no permissions,
 * so staff creation and import can never be used to escalate privileges.
 */
export async function roleOptionsFor(user: CurrentUser): Promise<{ key: string; name: string }[]> {
  const all = await assignableRoles();
  if (user.isSuperAdmin) return all;
  await connectDB();
  const roles = await Role.find({ key: { $in: all.map((r) => r.key) } }, { key: 1, permissions: 1 }).lean();
  if (can(user, "users.manage")) {
    const own = new Set<string>(user.permissions);
    const within = new Set(roles.filter((r) => r.permissions.every((p) => own.has(p))).map((r) => r.key));
    return all.filter((r) => within.has(r.key));
  }
  const keys = new Set(roles.filter((r) => r.permissions.length === 0).map((r) => r.key));
  const limited = all.filter((r) => keys.has(r.key));
  return limited.length > 0 ? limited : all.filter((r) => ["employee", "trainee", "intern"].includes(r.key));
}

export function lifecycleEvent(
  actor: Pick<CurrentUser, "_id" | "name">,
  e: { type: LifecycleType; date?: string; summary: string; from?: string; to?: string; note?: string; confidential?: boolean },
): LifecycleEvent {
  return {
    type: e.type,
    date: e.date ?? todayKey(),
    summary: e.summary,
    from: e.from,
    to: e.to,
    note: e.note,
    confidential: e.confidential ?? false,
    by: actor._id,
    byName: actor.name,
    at: new Date(),
  };
}

/* ------------------------------------------------------------------ */
/* Onboarding checklist                                                */
/* ------------------------------------------------------------------ */

/** Sets one onboarding step (creating it on legacy records that lack the checklist). */
export async function setOnboardingStep(userId: string | Types.ObjectId, key: string, done: boolean, by?: Types.ObjectId): Promise<void> {
  await connectDB();
  const label = ONBOARDING_STEPS.find((s) => s.key === key)?.label ?? key;
  const set: Record<string, unknown> = { "onboarding.$.done": done };
  if (done) {
    set["onboarding.$.doneAt"] = new Date();
    if (by) set["onboarding.$.doneBy"] = by;
  }
  const res = await User.updateOne(
    { _id: userId, "onboarding.key": key },
    done ? { $set: set } : { $set: set, $unset: { "onboarding.$.doneAt": "", "onboarding.$.doneBy": "" } },
  );
  if (res.matchedCount === 0) {
    await User.updateOne(
      { _id: userId, "onboarding.key": { $ne: key } },
      { $push: { onboarding: { key, label, done, doneAt: done ? new Date() : undefined, doneBy: done ? by : undefined } } },
    );
  }
}

/** Marks steps done when their condition is met (never un-marks, so manual ticks are respected). */
export async function autoCompleteSteps(userId: string | Types.ObjectId): Promise<void> {
  await connectDB();
  const u = await User.findById(userId, { department: 1, designation: 1, reportingManager: 1, "internship.mentor": 1, accountActive: 1, onboarding: 1, personType: 1 }).lean();
  if (!u) return;
  const done = new Set((u.onboarding ?? []).filter((s) => s.done).map((s) => s.key));
  const ready: string[] = [];
  if (u.department && u.designation) ready.push("dept_role");
  if (u.reportingManager || u.internship?.mentor) ready.push("manager");
  if (u.accountActive) ready.push("access");

  const settings = await getSettings();
  const files = await StoredFile.find(
    { entityType: "user", entityId: u._id.toString(), deletedAt: null, replacedBy: null, category: { $nin: [null, ""] } },
    { category: 1 },
  ).lean();
  if (missingRequired(settings.documentCategories, u.personType, new Set(files.map((f) => f.category!))).length === 0) ready.push("documents");

  for (const key of ready) {
    if (!done.has(key)) await setOnboardingStep(u._id, key, true);
  }
}

/* ------------------------------------------------------------------ */
/* Money lines                                                         */
/* ------------------------------------------------------------------ */

function asArray(value: unknown): string[] {
  if (value == null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).map((x) => String(x));
}

/** Zips `xName[]` / `xAmount[]` form arrays into validated money lines (blank rows are skipped). */
export function parseMoneyLines(names: unknown, amounts: unknown, label: string): MoneyLine[] {
  const n = asArray(names);
  const a = asArray(amounts);
  const out: MoneyLine[] = [];
  n.forEach((rawName, i) => {
    const name = rawName.trim();
    const rawAmount = (a[i] ?? "").replace(/,/g, "").trim();
    if (!name && !rawAmount) return;
    if (!name) throw new ActionError(`${label} line ${i + 1} needs a name`);
    if (name.length > 80) throw new ActionError(`${label} "${name.slice(0, 20)}…" has a name that is too long`);
    const amount = rawAmount === "" ? 0 : Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) throw new ActionError(`${label} "${name}" must be a non-negative amount`);
    out.push({ name, amount: Math.round(amount * 100) / 100 });
  });
  if (out.length > 20) throw new ActionError(`Too many ${label.toLowerCase()} lines (maximum 20)`);
  return out;
}

export function buildSalary(input: { basic: number; allowances: MoneyLine[]; deductions: MoneyLine[]; effectiveFrom?: string }): SalaryStructure {
  return {
    basic: Math.round(input.basic * 100) / 100,
    allowances: input.allowances,
    deductions: input.deductions,
    effectiveFrom: input.effectiveFrom,
  };
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const optPeriod = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["monthly", "one_time"]).default("monthly"));

/** Form schema for /staff/new (money-line arrays are parsed separately with `parseMoneyLines`). */
export const createPersonSchema = z.object({
  name: zs.text("Name", 120),
  email: zs.email("Work email"),
  phone: zs.optText(30),
  personalEmail: zs.optEmail(),
  dob: zs.optDate(),
  gender: zs.optText(20),
  bloodGroup: zs.optText(5),
  personType: z.enum(["employee", "trainee", "intern"], { error: "Choose a person type" }),
  role: zs.text("Role", 60),
  department: zs.optId(),
  designation: zs.optId(),
  employmentType: zs.optText(30),
  joiningDate: zs.date("Joining date"),
  reportingManager: zs.optId(),
  team: zs.optText(80),
  internStartDate: zs.optDate(),
  internEndDate: zs.optDate(),
  college: zs.optText(150),
  course: zs.optText(150),
  mentor: zs.optId(),
  assignedRole: zs.optText(100),
  stipendEligible: zs.bool(),
  stipendAmount: zs.optNum({ min: 0 }),
  stipendPeriod: optPeriod,
  salaryBasic: zs.optNum({ min: 0 }),
  salaryEffectiveFrom: zs.optDate(),
  loginAccess: zs.bool(),
});

export interface NewPerson {
  name: string;
  email: string;
  phone?: string;
  personalEmail?: string;
  dob?: string;
  gender?: string;
  bloodGroup?: string;
  personType: NewPersonType;
  role: string;
  department?: string;
  designation?: string;
  employmentType?: string;
  joiningDate?: string;
  reportingManager?: string;
  team?: string;
  internship?: {
    startDate?: string;
    endDate?: string;
    college?: string;
    course?: string;
    mentor?: string;
    assignedRole?: string;
    stipend: { eligible: boolean; amount: number; period: "monthly" | "one_time" };
  };
  salary?: SalaryStructure;
  accountActive: boolean;
}

interface CreateOptions {
  /** Notify the reporting manager / mentor (bulk import sends one summary instead). */
  notifyPeople?: boolean;
  /** Pre-resolved allowed role keys (avoids a lookup per row in bulk imports). */
  allowedRoles?: ReadonlySet<string>;
}

function isActiveStaff(u: { personType: string; status: string }): boolean {
  return u.personType !== "admin" && !EXITED.includes(u.status);
}

/** Validates references, generates the ID and creates the person with checklist + joined event. */
export async function createPersonRecord(
  actor: CurrentUser,
  p: NewPerson,
  opts: CreateOptions = {},
): Promise<{ id: string; employeeId: string; name: string }> {
  await connectDB();
  const email = p.email.trim().toLowerCase();
  const adminEmail = superAdminEmail();
  if (adminEmail && email === adminEmail) {
    throw new ActionError("This email belongs to the super admin account.", { email: "Reserved for the super admin" });
  }
  if (await User.exists({ email: emailRegex(email) })) {
    throw new ActionError("A person with this email already exists.", { email: "Already in use" });
  }

  const allowed = opts.allowedRoles ?? new Set((await roleOptionsFor(actor)).map((r) => r.key));
  if (!allowed.has(p.role)) throw new ActionError("You can't assign this role.", { role: "Role not allowed" });

  const employmentType = p.employmentType || DEFAULT_EMPLOYMENT_TYPE[p.personType];
  if (!EMPLOYMENT_TYPE_KEYS.includes(employmentType)) throw new ActionError("Choose a valid employment type.", { employmentType: "Invalid" });

  const mentorId = p.internship?.mentor;
  const [dept, desig, manager, mentor] = await Promise.all([
    p.department ? Department.findById(p.department, { name: 1 }).lean() : null,
    p.designation ? Designation.findById(p.designation, { name: 1 }).lean() : null,
    p.reportingManager ? User.findById(p.reportingManager, { name: 1, personType: 1, status: 1 }).lean() : null,
    mentorId ? User.findById(mentorId, { name: 1, personType: 1, status: 1 }).lean() : null,
  ]);
  if (p.department && !dept) throw new ActionError("Department not found.", { department: "Not found" });
  if (p.designation && !desig) throw new ActionError("Designation not found.", { designation: "Not found" });
  if (p.reportingManager && (!manager || !isActiveStaff(manager))) throw new ActionError("Choose an active staff member as reporting manager.", { reportingManager: "Not available" });
  if (mentorId && (!mentor || !isActiveStaff(mentor))) throw new ActionError("Choose an active staff member as mentor.", { mentor: "Not available" });

  const today = todayKey();
  const joiningDate = p.joiningDate;
  const internLike = p.personType !== "employee";
  let internship: Record<string, unknown> | undefined;
  if (internLike) {
    const startDate = p.internship?.startDate ?? joiningDate;
    const endDate = p.internship?.endDate;
    if (startDate && endDate && endDate < startDate) throw new ActionError("End date must be after the start date.", { internEndDate: "Must be after start" });
    const stipend = p.internship?.stipend ?? { eligible: false, amount: 0, period: "monthly" as const };
    internship = {
      startDate,
      endDate,
      college: p.internship?.college,
      course: p.internship?.course,
      assignedRole: p.internship?.assignedRole,
      mentor: mentorId,
      objectives: [],
      status: startDate && startDate <= today ? "active" : "registered",
      stipend,
      stipendHistory: stipend.eligible && stipend.amount > 0 ? [{ amount: stipend.amount, effectiveFrom: startDate, note: "Initial stipend", by: actor._id, at: new Date() }] : [],
      certificateStatus: "none",
    };
  }

  const employeeId = await nextNumber(p.personType, ID_PREFIX[p.personType], 4);
  const now = new Date();
  const doc = await User.create({
    employeeId,
    name: p.name.trim(),
    email,
    personalEmail: p.personalEmail,
    phone: p.phone,
    personType: p.personType,
    role: p.role,
    isSuperAdmin: false,
    department: p.department,
    designation: p.designation,
    employmentType,
    joiningDate,
    status: "active",
    accountActive: p.accountActive,
    reportingManager: p.reportingManager,
    team: p.team,
    dob: p.dob,
    gender: p.gender,
    bloodGroup: p.bloodGroup,
    internship,
    salary: p.salary,
    salaryHistory: p.salary ? [{ ...p.salary, note: "Initial salary", by: actor._id, byName: actor.name, at: now }] : [],
    onboarding: ONBOARDING_STEPS.map((s) => {
      const done =
        s.key === "record_created" ||
        (s.key === "dept_role" && Boolean(p.department && p.designation)) ||
        (s.key === "manager" && Boolean(p.reportingManager || mentorId)) ||
        (s.key === "access" && p.accountActive);
      return { key: s.key, label: s.label, done: done && s.key !== AUTO_ONBOARDING_KEY, doneAt: done ? now : undefined, doneBy: done ? actor._id : undefined };
    }),
    history: [
      lifecycleEvent(actor, {
        type: "joined",
        date: joiningDate ?? today,
        summary: desig ? `Joined as ${desig.name}` : "Joined D4DX",
        to: desig?.name,
      }),
    ],
    createdBy: actor._id,
  });

  await audit(actor, {
    action: "create",
    entity: "user",
    entityId: doc._id,
    ref: employeeId,
    summary: `Added ${doc.name} (${employeeId}) as ${p.personType}`,
  });

  if (opts.notifyPeople !== false) {
    const type = internLike ? "internship" : "system";
    await notify(
      [p.reportingManager],
      { type, title: `${doc.name} joins your team`, body: `${doc.name} (${employeeId}) has been added with you as reporting manager.`, link: `/staff/${doc._id}` },
      [actor._id],
    );
    if (mentorId && mentorId !== p.reportingManager) {
      await notify(
        [mentorId],
        { type: "internship", title: `You are the mentor for ${doc.name}`, body: `${doc.name} (${employeeId}) has been registered with you as mentor.`, link: `/interns/${doc._id}` },
        [actor._id],
      );
    }
  }

  return { id: doc._id.toString(), employeeId, name: doc.name };
}
