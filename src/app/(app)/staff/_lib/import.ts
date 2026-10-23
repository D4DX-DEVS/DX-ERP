import "server-only";
import { z } from "zod";
import type { CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Department, Designation, User } from "@/lib/models";
import { todayKey } from "@/lib/time";
import { DEFAULT_EMPLOYMENT_TYPE, DEFAULT_ROLE_FOR, EMPLOYMENT_TYPE_KEYS, type NewPersonType } from "./constants";
import { roleOptionsFor, superAdminEmail, type NewPerson } from "./person";

export const IMPORT_COLUMNS = ["name", "email", "personType", "role", "department", "designation", "employmentType", "joiningDate", "phone", "reportingManagerEmail"] as const;
export const MAX_IMPORT_ROWS = 500;

const cell = z.string().max(300).optional();

export const importSchema = z.object({
  rows: z
    .array(
      z.object({
        name: cell,
        email: cell,
        personType: cell,
        role: cell,
        department: cell,
        designation: cell,
        employmentType: cell,
        joiningDate: cell,
        phone: cell,
        reportingManagerEmail: cell,
      }),
    )
    .min(1, "The file has no data rows")
    .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`),
  enableLogin: z.boolean().optional(),
});

export type ImportRowInput = z.infer<typeof importSchema>["rows"][number];

export interface ImportPreviewRow {
  /** 1-based data row number (header excluded). */
  line: number;
  name: string;
  email: string;
  personType: string;
  role: string;
  department: string;
  designation: string;
  joiningDate: string;
  manager: string;
  issues: string[];
  valid: boolean;
}

export interface ImportAnalysis {
  preview: ImportPreviewRow[];
  /** Normalised records, aligned with `preview` (null for invalid rows). */
  people: (NewPerson | null)[];
}

function normaliseDate(raw: string): string | null {
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (dmy) {
    [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const emailSchema = z.email();

/** Validates CSV rows against the live directory (duplicates, unknown references, role limits). */
export async function analyseImport(user: CurrentUser, rows: ImportRowInput[]): Promise<ImportAnalysis> {
  await connectDB();
  const [users, departments, designations, roles] = await Promise.all([
    User.find({}, { email: 1, personType: 1, status: 1 }).lean(),
    Department.find({}, { name: 1, code: 1 }).lean(),
    Designation.find({}, { name: 1 }).lean(),
    roleOptionsFor(user),
  ]);
  const existing = new Set(users.map((u) => u.email.toLowerCase()));
  const managers = new Map(
    users.filter((u) => u.personType !== "admin" && !["resigned", "terminated", "inactive"].includes(u.status)).map((u) => [u.email.toLowerCase(), u._id.toString()]),
  );
  const deptByName = new Map<string, string>();
  for (const d of departments) {
    deptByName.set(d.name.toLowerCase(), d._id.toString());
    if (d.code) deptByName.set(d.code.toLowerCase(), d._id.toString());
  }
  const desigByName = new Map(designations.map((d) => [d.name.toLowerCase(), d._id.toString()]));
  const roleByLabel = new Map<string, string>();
  for (const r of roles) {
    roleByLabel.set(r.key.toLowerCase(), r.key);
    roleByLabel.set(r.name.toLowerCase(), r.key);
  }
  const adminEmail = superAdminEmail();
  const seen = new Map<string, number>();
  const today = todayKey();

  const preview: ImportPreviewRow[] = [];
  const people: (NewPerson | null)[] = [];

  rows.forEach((raw, index) => {
    const line = index + 1;
    const issues: string[] = [];
    const v = (s?: string) => (s ?? "").trim();
    const name = v(raw.name);
    const email = v(raw.email).toLowerCase();
    const typeRaw = v(raw.personType).toLowerCase();
    const roleRaw = v(raw.role);
    const deptRaw = v(raw.department);
    const desigRaw = v(raw.designation);
    const empRaw = v(raw.employmentType);
    const joinRaw = v(raw.joiningDate);
    const phone = v(raw.phone);
    const mgrRaw = v(raw.reportingManagerEmail).toLowerCase();

    if (!name) issues.push("Name is required");
    if (!email) issues.push("Email is required");
    else if (!emailSchema.safeParse(email).success) issues.push("Email is not valid");
    else if (email.endsWith("@example.com")) issues.push("Example row — remove it from the file");
    else if (adminEmail && email === adminEmail) issues.push("Email is reserved for the super admin");
    else if (existing.has(email)) issues.push("A person with this email already exists");
    else if (seen.has(email)) issues.push(`Duplicate of row ${seen.get(email)} in this file`);
    if (email && !seen.has(email)) seen.set(email, line);

    let personType: NewPersonType = "employee";
    if (typeRaw) {
      if (typeRaw === "employee" || typeRaw === "trainee" || typeRaw === "intern") personType = typeRaw;
      else issues.push(`Unknown person type "${raw.personType?.trim()}"`);
    }

    let role = roleByLabel.get(DEFAULT_ROLE_FOR[personType]) ?? DEFAULT_ROLE_FOR[personType];
    if (roleRaw) {
      const found = roleByLabel.get(roleRaw.toLowerCase());
      if (found) role = found;
      else issues.push(`Unknown or unavailable role "${roleRaw}"`);
    } else if (!roleByLabel.has(DEFAULT_ROLE_FOR[personType])) {
      issues.push("Default role is not available to you — specify a role");
    }

    let department: string | undefined;
    if (deptRaw) {
      department = deptByName.get(deptRaw.toLowerCase());
      if (!department) issues.push(`Unknown department "${deptRaw}"`);
    }
    let designation: string | undefined;
    if (desigRaw) {
      designation = desigByName.get(desigRaw.toLowerCase());
      if (!designation) issues.push(`Unknown designation "${desigRaw}"`);
    }

    let employmentType = DEFAULT_EMPLOYMENT_TYPE[personType];
    if (empRaw) {
      const key = empRaw.toLowerCase().replace(/[\s-]+/g, "_");
      if (EMPLOYMENT_TYPE_KEYS.includes(key)) employmentType = key;
      else issues.push(`Unknown employment type "${empRaw}"`);
    }

    let joiningDate: string | undefined;
    if (joinRaw) {
      joiningDate = normaliseDate(joinRaw) ?? undefined;
      if (!joiningDate) issues.push(`Joining date "${joinRaw}" is not valid (use yyyy-mm-dd)`);
    }

    if (phone.length > 30) issues.push("Phone is too long");

    let reportingManager: string | undefined;
    if (mgrRaw) {
      reportingManager = managers.get(mgrRaw);
      if (!reportingManager) issues.push(`Unknown manager email "${mgrRaw}"`);
    }

    const valid = issues.length === 0;
    preview.push({
      line,
      name,
      email,
      personType: typeRaw || "employee",
      role: roleRaw || role,
      department: deptRaw,
      designation: desigRaw,
      joiningDate: joiningDate ?? joinRaw,
      manager: mgrRaw,
      issues,
      valid,
    });
    people.push(
      valid
        ? {
            name,
            email,
            phone: phone || undefined,
            personType,
            role,
            department,
            designation,
            employmentType,
            joiningDate: joiningDate ?? today,
            reportingManager,
            internship: personType === "employee" ? undefined : { startDate: joiningDate ?? today, stipend: { eligible: false, amount: 0, period: "monthly" } },
            accountActive: false,
          }
        : null,
    );
  });

  return { preview, people };
}
