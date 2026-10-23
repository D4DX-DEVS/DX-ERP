import "server-only";
import { and, eq, getTableColumns, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { ActionError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can, requestMeta, type CurrentUser } from "@/lib/auth/session";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  AuditLog,
  Counter,
  Department,
  Designation,
  Role,
  StoredFile,
  User,
  newId,
  type Id,
  type Internship,
  type LifecycleEvent,
  type LifecycleType,
  type MoneyLine,
  type OnboardingStep,
  type SalaryStructure,
} from "@/lib/models";
import { notify } from "@/lib/notify";
import { assignableRoles } from "@/lib/rbac/roles";
import { getSettings } from "@/lib/settings";
import { eqIgnoreCase, inList } from "@/lib/sql";
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

/** Case-insensitive match of a work email (emails are stored lowercased + trimmed). */
export function emailMatch(email: string): SQL {
  return eqIgnoreCase(User.email, email.trim());
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
  const roles = await db()
    .select({ key: Role.key, permissions: Role.permissions })
    .from(Role)
    .where(inList(Role.key, all.map((r) => r.key)));
  if (can(user, "users.manage")) {
    const own = new Set<string>(user.permissions);
    const within = new Set(roles.filter((r) => r.permissions.every((p) => own.has(p))).map((r) => r.key));
    return all.filter((r) => within.has(r.key));
  }
  const keys = new Set(roles.filter((r) => r.permissions.length === 0).map((r) => r.key));
  const limited = all.filter((r) => keys.has(r.key));
  return limited.length > 0 ? limited : all.filter((r) => ["employee", "trainee", "intern"].includes(r.key));
}

/** `obj`, or `null` when every field is empty — how a nested JSON column (address, emergency contact) is cleared. */
export function orNull<T extends object>(obj: T): T | null {
  return Object.values(obj).some((v) => v !== undefined && v !== "") ? obj : null;
}

export function lifecycleEvent(
  actor: Pick<CurrentUser, "_id" | "name">,
  e: { type: LifecycleType; date?: string; summary: string; from?: string; to?: string; note?: string; confidential?: boolean },
): LifecycleEvent {
  return {
    _id: newId(),
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

/** Returns the checklist with one step set (appending it on legacy records that lack the step). */
function withOnboardingStep(steps: OnboardingStep[], key: string, done: boolean, by?: Id): OnboardingStep[] {
  const label = ONBOARDING_STEPS.find((s) => s.key === key)?.label ?? key;
  if (!steps.some((s) => s.key === key)) {
    return [...steps, { key, label, done, doneAt: done ? new Date() : undefined, doneBy: done ? by : undefined }];
  }
  return steps.map((s) => {
    if (s.key !== key) return s;
    if (!done) return { key: s.key, label: s.label, done };
    return { ...s, done, doneAt: new Date(), ...(by ? { doneBy: by } : {}) };
  });
}

/** Sets one onboarding step (creating it on legacy records that lack the checklist). */
export async function setOnboardingStep(userId: Id, key: string, done: boolean, by?: Id): Promise<void> {
  const [u] = await db().select({ onboarding: User.onboarding }).from(User).where(eq(User._id, userId)).limit(1);
  if (!u) return;
  await db()
    .update(User)
    .set({ onboarding: withOnboardingStep(u.onboarding ?? [], key, done, by) })
    .where(eq(User._id, userId));
}

/** Marks steps done when their condition is met (never un-marks, so manual ticks are respected). */
export async function autoCompleteSteps(userId: Id): Promise<void> {
  const [u] = await db()
    .select({
      _id: User._id,
      department: User.department,
      designation: User.designation,
      reportingManager: User.reportingManager,
      internship: User.internship,
      accountActive: User.accountActive,
      onboarding: User.onboarding,
      personType: User.personType,
    })
    .from(User)
    .where(eq(User._id, userId))
    .limit(1);
  if (!u) return;
  const steps = u.onboarding ?? [];
  const done = new Set(steps.filter((s) => s.done).map((s) => s.key));
  const ready: string[] = [];
  if (u.department && u.designation) ready.push("dept_role");
  if (u.reportingManager || u.internship?.mentor) ready.push("manager");
  if (u.accountActive) ready.push("access");

  const settings = await getSettings();
  const files = await db()
    .select({ category: StoredFile.category })
    .from(StoredFile)
    .where(
      and(
        eq(StoredFile.entityType, "user"),
        eq(StoredFile.entityId, u._id),
        isNull(StoredFile.deletedAt),
        isNull(StoredFile.replacedBy),
        isNotNull(StoredFile.category),
        ne(StoredFile.category, ""),
      ),
    );
  if (missingRequired(settings.documentCategories, u.personType, new Set(files.map((f) => f.category!))).length === 0) ready.push("documents");

  const pending = ready.filter((key) => !done.has(key));
  if (pending.length === 0) return;
  // One write for every newly met step (the Mongo version issued one update per step).
  const next = pending.reduce((acc, key) => withOnboardingStep(acc, key, true), steps);
  await db().update(User).set({ onboarding: next }).where(eq(User._id, u._id));
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

function isActiveStaff(u: { personType: string; status: string }): boolean {
  return u.personType !== "admin" && !EXITED.includes(u.status);
}

/** Builds the user row (checklist, joined event, internship, initial salary) for an already validated person. */
function buildPersonRow(actor: CurrentUser, p: NewPerson, employeeId: string, email: string, employmentType: string, designationName: string | undefined): typeof User.$inferInsert & { _id: Id } {
  const today = todayKey();
  const joiningDate = p.joiningDate;
  const mentorId = p.internship?.mentor;
  let internship: Internship | undefined;
  if (p.personType !== "employee") {
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
      stipendHistory: stipend.eligible && stipend.amount > 0 ? [{ _id: newId(), amount: stipend.amount, effectiveFrom: startDate, note: "Initial stipend", by: actor._id, at: new Date() }] : [],
      certificateStatus: "none",
    };
  }

  const now = new Date();
  return {
    _id: newId(),
    employeeId,
    name: p.name.trim(),
    email,
    personalEmail: p.personalEmail?.trim().toLowerCase(),
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
    salaryHistory: p.salary ? [{ ...p.salary, _id: newId(), note: "Initial salary", by: actor._id, byName: actor.name, at: now }] : [],
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
        summary: designationName ? `Joined as ${designationName}` : "Joined D4DX",
        to: designationName,
      }),
    ],
    createdBy: actor._id,
  };
}

/** Validates references, generates the ID and creates the person with checklist + joined event. */
export async function createPersonRecord(actor: CurrentUser, p: NewPerson): Promise<{ id: string; employeeId: string; name: string }> {
  const email = p.email.trim().toLowerCase();
  const adminEmail = superAdminEmail();
  if (adminEmail && email === adminEmail) {
    throw new ActionError("This email belongs to the super admin account.", { email: "Reserved for the super admin" });
  }
  const [emailClash] = await db().select({ id: User._id }).from(User).where(emailMatch(email)).limit(1);
  if (emailClash) {
    throw new ActionError("A person with this email already exists.", { email: "Already in use" });
  }

  const allowed = new Set((await roleOptionsFor(actor)).map((r) => r.key));
  if (!allowed.has(p.role)) throw new ActionError("You can't assign this role.", { role: "Role not allowed" });

  const employmentType = p.employmentType || DEFAULT_EMPLOYMENT_TYPE[p.personType];
  if (!EMPLOYMENT_TYPE_KEYS.includes(employmentType)) throw new ActionError("Choose a valid employment type.", { employmentType: "Invalid" });

  const mentorId = p.internship?.mentor;
  const personById = (id: Id) =>
    db().select({ name: User.name, personType: User.personType, status: User.status }).from(User).where(eq(User._id, id)).limit(1).then((r) => r[0]);
  const [dept, desig, manager, mentor] = await Promise.all([
    p.department ? db().select({ name: Department.name }).from(Department).where(eq(Department._id, p.department)).limit(1).then((r) => r[0]) : undefined,
    p.designation ? db().select({ name: Designation.name }).from(Designation).where(eq(Designation._id, p.designation)).limit(1).then((r) => r[0]) : undefined,
    p.reportingManager ? personById(p.reportingManager) : undefined,
    mentorId ? personById(mentorId) : undefined,
  ]);
  if (p.department && !dept) throw new ActionError("Department not found.", { department: "Not found" });
  if (p.designation && !desig) throw new ActionError("Designation not found.", { designation: "Not found" });
  if (p.reportingManager && (!manager || !isActiveStaff(manager))) throw new ActionError("Choose an active staff member as reporting manager.", { reportingManager: "Not available" });
  if (mentorId && (!mentor || !isActiveStaff(mentor))) throw new ActionError("Choose an active staff member as mentor.", { mentor: "Not available" });

  const internLike = p.personType !== "employee";
  // Built first (it validates the internship dates) so a validation error doesn't use up an employee number.
  const row = buildPersonRow(actor, p, "", email, employmentType, desig?.name);
  row.employeeId = await nextNumber(p.personType, ID_PREFIX[p.personType], 4);
  const [doc] = await db().insert(User).values(row).returning({ _id: User._id, name: User.name, employeeId: User.employeeId });

  await audit(actor, {
    action: "create",
    entity: "user",
    entityId: doc._id,
    ref: doc.employeeId,
    summary: `Added ${doc.name} (${doc.employeeId}) as ${p.personType}`,
  });

  const type = internLike ? "internship" : "system";
  await notify(
    [p.reportingManager],
    { type, title: `${doc.name} joins your team`, body: `${doc.name} (${doc.employeeId}) has been added with you as reporting manager.`, link: `/staff/${doc._id}` },
    [actor._id],
  );
  if (mentorId && mentorId !== p.reportingManager) {
    await notify(
      [mentorId],
      { type: "internship", title: `You are the mentor for ${doc.name}`, body: `${doc.name} (${doc.employeeId}) has been registered with you as mentor.`, link: `/interns/${doc._id}` },
      [actor._id],
    );
  }

  return { id: doc._id, employeeId: doc.employeeId, name: doc.name };
}

/** Reserves `n` consecutive numbers of a sequence in one write; returns the last number before the range. */
async function reserveSeq(name: string, n: number): Promise<number> {
  const [row] = await db()
    .insert(Counter)
    .values({ _id: name, seq: n })
    .onConflictDoUpdate({ target: Counter._id, set: { seq: sql`${Counter.seq} + ${n}` } })
    .returning({ seq: Counter.seq });
  return row.seq - n;
}

/**
 * Bulk create for the CSV import. `analyseImport` has already checked emails, references, employment
 * types and roles against the live data, so there are no per-row lookups here (D1 caps the queries per
 * request): each person type's ID range is reserved with one counter write, and the people and their
 * audit entries are written as two atomic batches. Notifying managers is left to the caller.
 */
export async function createPeopleBulk(actor: CurrentUser, people: NewPerson[]): Promise<{ id: string; employeeId: string; name: string }[]> {
  if (people.length === 0) return [];
  const designationIds = [...new Set(people.flatMap((p) => (p.designation ? [p.designation] : [])))];
  const designations = designationIds.length ? await db().select({ _id: Designation._id, name: Designation.name }).from(Designation).where(inList(Designation._id, designationIds)) : [];
  const designationName = new Map(designations.map((d) => [d._id, d.name]));

  const next: Record<NewPersonType, number> = { employee: 0, trainee: 0, intern: 0 };
  for (const type of ["employee", "trainee", "intern"] as const) {
    const n = people.filter((p) => p.personType === type).length;
    if (n > 0) next[type] = await reserveSeq(type, n);
  }
  const rows = people.map((p) => {
    const type = p.personType;
    next[type] += 1;
    const employeeId = `${ID_PREFIX[type]}${String(next[type]).padStart(4, "0")}`;
    const employmentType = p.employmentType || DEFAULT_EMPLOYMENT_TYPE[type];
    return buildPersonRow(actor, p, employeeId, p.email.trim().toLowerCase(), employmentType, p.designation ? designationName.get(p.designation) : undefined);
  });

  await batchInsert(User, rows);

  try {
    const meta = await requestMeta().catch(() => ({ ip: undefined, userAgent: undefined }));
    await batchInsert(
      AuditLog,
      rows.map((r) => ({
        actor: actor._id,
        actorName: actor.name,
        actorRole: actor.role,
        action: "create",
        entity: "user",
        entityId: r._id,
        ref: r.employeeId,
        summary: `Added ${r.name} (${r.employeeId}) as ${r.personType}`,
        ip: meta.ip,
        userAgent: meta.userAgent,
        at: new Date(),
      })),
    );
  } catch (error) {
    console.error("[audit] failed to record", error);
  }
  return rows.map((r) => ({ id: r._id, employeeId: r.employeeId, name: r.name }));
}

/** Multi-row insert as ONE atomic D1 batch (statements are sized for the 100-bound-parameter limit). */
async function batchInsert<T extends SQLiteTable>(table: T, rows: T["$inferInsert"][]): Promise<void> {
  if (rows.length === 0) return;
  const size = Math.max(1, Math.floor(100 / Object.keys(getTableColumns(table)).length));
  const statements = [];
  for (let i = 0; i < rows.length; i += size) statements.push(db().insert(table).values(rows.slice(i, i + size)));
  await db().batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
}
