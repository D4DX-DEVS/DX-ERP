/**
 * Client-safe constants and small pure helpers shared by the People module
 * (staff, interns, learning, profile). No server-only imports here.
 */
import { diffDays, todayKey } from "@/lib/time";

export type NewPersonType = "employee" | "trainee" | "intern";

export const NEW_PERSON_TYPES: { value: NewPersonType; label: string; hint: string }[] = [
  { value: "employee", label: "Employee", hint: "Salary, probation" },
  { value: "trainee", label: "Trainee", hint: "Stipend, mentor, end date" },
  { value: "intern", label: "Intern", hint: "Objectives, certificate" },
];

/** Same keys as EMPLOYMENT_TYPES in the User model (kept here so client code never imports Mongoose). */
export const EMPLOYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "consultant", label: "Consultant" },
  { value: "trainee", label: "Trainee" },
  { value: "internship", label: "Internship" },
];

export const EMPLOYMENT_TYPE_KEYS = EMPLOYMENT_TYPE_OPTIONS.map((o) => o.value);

export function employmentTypeLabel(value: string | null | undefined): string {
  return EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? (value ? value.replace(/_/g, " ") : "—");
}

export const DEFAULT_EMPLOYMENT_TYPE: Record<NewPersonType, string> = {
  employee: "full_time",
  trainee: "trainee",
  intern: "internship",
};

/** Role key preselected for each person type. */
export const DEFAULT_ROLE_FOR: Record<NewPersonType, string> = {
  employee: "employee",
  trainee: "trainee",
  intern: "intern",
};

export const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "undisclosed", label: "Prefer not to say" },
];

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function genderLabel(value: string | null | undefined): string {
  return GENDER_OPTIONS.find((o) => o.value === value)?.label ?? (value ? value : "—");
}

export const STIPEND_PERIODS: { value: "monthly" | "one_time"; label: string }[] = [
  { value: "monthly", label: "Per month" },
  { value: "one_time", label: "One-time" },
];

/** Onboarding checklist (FRS §24.1). `first_login` is marked automatically by the Google callback. */
export const ONBOARDING_STEPS: { key: string; label: string; hint: string }[] = [
  { key: "record_created", label: "Record created", hint: "Basic details captured" },
  { key: "dept_role", label: "Department & role assigned", hint: "Department and designation set" },
  { key: "documents", label: "Documents collected", hint: "All required documents on file" },
  { key: "manager", label: "Reporting manager assigned", hint: "Manager or mentor linked" },
  { key: "access", label: "Login access activated", hint: "Can sign in with Google" },
  { key: "first_login", label: "First sign-in", hint: "Marked automatically" },
];

export const AUTO_ONBOARDING_KEY = "first_login";

export const RELATIONS = ["Parent", "Spouse", "Sibling", "Guardian", "Friend", "Other"];

/** "2 y 8 m", "5 m", "" when the date is missing / in the future. */
export function tenureLabel(from: string | null | undefined, to: string = todayKey()): string {
  if (!from) return "";
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  if (months < 0) return "";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return rest === 0 ? "< 1 m" : `${rest} m`;
  return `${years} y ${rest} m`;
}

/** Internship progress: share of the period elapsed (clamped to 0–100). */
export function internshipProgress(start?: string, end?: string, today: string = todayKey()) {
  if (!start || !end || end < start) return { pct: 0, elapsed: 0, total: 0, daysLeft: null as number | null, started: false, finished: false };
  const total = Math.max(1, diffDays(start, end));
  const elapsed = diffDays(start, today);
  const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  return { pct, elapsed: Math.max(0, elapsed), total, daysLeft: diffDays(today, end), started: elapsed >= 0, finished: today > end };
}

/** First name for certificate / greeting text. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export interface SalaryLike {
  basic: number;
  allowances: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
}

/** Gross = basic + allowances; net = gross − deductions. */
export function salaryTotals(s: SalaryLike): { gross: number; deductions: number; net: number } {
  const gross = s.basic + s.allowances.reduce((sum, l) => sum + l.amount, 0);
  const deductions = s.deductions.reduce((sum, l) => sum + l.amount, 0);
  return { gross, deductions, net: gross - deductions };
}
