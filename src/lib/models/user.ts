import { sql } from "drizzle-orm";
import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { bool, date, json, pk, ref, text, timestamps, type Address, type Id } from "./_base";

export type PersonType = "employee" | "trainee" | "intern" | "admin";
export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];
export const PERSON_TYPES: PersonType[] = ["employee", "trainee", "intern"];

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "consultant",
  "trainee",
  "internship",
] as const;

export type LifecycleType =
  | "joined"
  | "promotion"
  | "designation_change"
  | "department_change"
  | "manager_change"
  | "role_change"
  | "salary_revision"
  | "stipend_revision"
  | "status_change"
  | "access_change"
  | "resignation"
  | "exit"
  | "note";

export interface LifecycleEvent {
  _id?: Id;
  type: LifecycleType;
  date: string;
  summary: string;
  from?: string;
  to?: string;
  note?: string;
  confidential?: boolean;
  by?: Id;
  byName?: string;
  at: Date;
}

export interface MoneyLine {
  name: string;
  amount: number;
}

export interface SalaryStructure {
  basic: number;
  allowances: MoneyLine[];
  deductions: MoneyLine[];
  effectiveFrom?: string;
}

export interface SalaryRevision extends SalaryStructure {
  _id?: Id;
  note?: string;
  by?: Id;
  byName?: string;
  at: Date;
}

export interface InternObjective {
  _id?: Id;
  text: string;
  status: "open" | "in_progress" | "achieved" | "dropped";
  note?: string;
  updatedAt?: Date;
}

export interface Internship {
  startDate?: string;
  endDate?: string;
  college?: string;
  course?: string;
  assignedRole?: string;
  mentor?: Id;
  objectives: InternObjective[];
  status: "registered" | "active" | "extended" | "completed" | "terminated";
  stipend: { eligible: boolean; amount: number; period: "monthly" | "one_time" };
  stipendHistory: { _id?: Id; amount: number; effectiveFrom?: string; note?: string; by?: Id; at: Date }[];
  certificateStatus: "none" | "requested" | "approved" | "issued";
  certificateNo?: string;
  certificateIssuedAt?: Date;
  certificateApprovedBy?: Id;
  completionNote?: string;
  completedAt?: Date;
}

export interface OnboardingStep {
  key: string;
  label: string;
  done: boolean;
  doneAt?: Date;
  doneBy?: Id;
}

export interface EmergencyContact {
  name?: string;
  relation?: string;
  phone?: string;
}

export interface BankDetails {
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  pan?: string;
  uan?: string;
}

export interface ExitInfo {
  resignationDate?: string;
  noticeDays?: number;
  lastWorkingDay?: string;
  reason?: string;
  stage: "none" | "notice" | "completed";
  clearanceNote?: string;
}

/** Writes must store `email`/`personalEmail` lowercased and trimmed (see `normalizeEmail`). */
export const User = sqliteTable(
  "users",
  {
    _id: pk(),
    employeeId: text().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    personalEmail: text(),
    phone: text(),
    whatsapp: text(),
    photo: text(),
    personType: text().$type<PersonType>().notNull().default("employee"),
    role: text().notNull(),
    isSuperAdmin: bool().notNull().default(false),
    department: ref(),
    designation: ref(),
    employmentType: text().notNull().default("full_time"),
    joiningDate: text(),
    /** Employment contract period ("yyyy-MM-dd"); no end date = open-ended. */
    contractStart: text(),
    contractEnd: text(),
    status: text().notNull().default("active"),
    accountActive: bool().notNull().default(false),
    reportingManager: ref(),
    team: text(),
    dob: text(),
    /** "male" | "female" (the only values accepted). */
    gender: text().$type<Gender>(),
    bloodGroup: text(),
    address: json<Address>(),
    emergencyContact: json<EmergencyContact>(),
    salary: json<SalaryStructure>(),
    salaryHistory: json<SalaryRevision[]>().notNull().$defaultFn(() => []),
    bank: json<BankDetails>(),
    exit: json<ExitInfo>().notNull().$defaultFn(() => ({ stage: "none" })),
    internship: json<Internship>(),
    onboarding: json<OnboardingStep[]>().notNull().$defaultFn(() => []),
    /** HR opened restricted document categories for the person to upload themself. */
    documentUploadOpen: bool().notNull().default(false),
    history: json<LifecycleEvent[]>().notNull().$defaultFn(() => []),
    googleSub: text(),
    lastLoginAt: date(),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("users_employee_id").on(t.employeeId),
    uniqueIndex("users_email").on(t.email),
    // Exactly one super admin row can exist.
    uniqueIndex("users_single_super_admin").on(t.isSuperAdmin).where(sql`"isSuperAdmin" = 1`),
    index("users_person_type").on(t.personType),
    index("users_role").on(t.role),
    index("users_department").on(t.department),
    index("users_status").on(t.status),
    index("users_reporting_manager").on(t.reportingManager),
    index("users_contract_end").on(t.contractEnd),
  ],
);

export type IUser = typeof User.$inferSelect;
export type NewUser = typeof User.$inferInsert;

/** Fields never sent to users without `staff.confidential`. */
export const CONFIDENTIAL_USER_FIELDS = ["salary", "salaryHistory", "bank"] as const;

