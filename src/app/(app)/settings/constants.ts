import type { Tone } from "@/lib/config-defaults";

/** Constants shared by the settings forms (client) and actions (server). */

export interface SectionDef {
  key: string;
  label: string;
  description: string;
  permission: "settings.manage" | "backup.manage";
}

export const SECTIONS: SectionDef[] = [
  { key: "company", label: "Company profile & logo", description: "Name, address, tax identifiers and branding shown on documents.", permission: "settings.manage" },
  { key: "organization", label: "Departments & designations", description: "The organisation structure used across staff records and assets.", permission: "settings.manage" },
  { key: "attendance", label: "Working days & attendance", description: "Working days, office hours and attendance rules.", permission: "settings.manage" },
  { key: "holidays", label: "Holidays", description: "Company holidays and optional holidays by year.", permission: "settings.manage" },
  { key: "leave", label: "Leave policies", description: "Leave categories, quotas and leave-year rules.", permission: "settings.manage" },
  { key: "payroll", label: "Payroll & stipend components", description: "Earning and deduction components, pay day and loss-of-pay basis.", permission: "settings.manage" },
  { key: "movement", label: "Movement & approval rules", description: "Movement categories, approval requirements and overdue rules.", permission: "settings.manage" },
  { key: "statuses", label: "Statuses & pipeline", description: "Project, task and employment statuses and CRM pipeline stages.", permission: "settings.manage" },
  { key: "lists", label: "Lists & categories", description: "Expense, asset, lead source and document categories.", permission: "settings.manage" },
  { key: "numbering", label: "Numbering & templates", description: "Document numbering, taxes, payment terms and standard text.", permission: "settings.manage" },
  { key: "notifications", label: "Notifications", description: "In-app and email notifications and reminder timing.", permission: "settings.manage" },
  { key: "data", label: "Data & security", description: "Retention, automatic backups and sign-in session lengths.", permission: "settings.manage" },
  { key: "backup", label: "Backup & restore", description: "Create, verify, download and restore backups of all business data.", permission: "backup.manage" },
];

/** Value = JS weekday (0 = Sunday), as used by lib/time `weekday()`. */
export const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const PERSON_TYPE_OPTIONS = [
  { value: "employee", label: "Employees" },
  { value: "trainee", label: "Trainees" },
  { value: "intern", label: "Interns" },
];

export const TONES: Tone[] = ["blue", "green", "amber", "red", "orange", "gray", "purple"];

export const PROJECT_CATEGORIES = ["enquiry", "planning", "active", "hold", "review", "completed", "cancelled"] as const;
export const TASK_CATEGORIES = ["open", "active", "review", "blocked", "done", "cancelled"] as const;
export const PIPELINE_CATEGORIES = ["open", "won", "lost"] as const;
export const EMPLOYMENT_CATEGORIES = ["active", "leave", "notice", "exited", "inactive"] as const;

export const CERTIFICATE_PLACEHOLDERS = ["{name}", "{firstName}", "{company}", "{role}", "{start}", "{end}"] as const;

/** Fiscal-year aware preview of an invoice number (mirrors lib/counters formatting). */
export function invoicePreview(prefix: string, padding: number, fiscal: boolean, fy: string): string {
  return `${prefix}${fiscal ? `${fy}-` : ""}${String(1).padStart(Math.max(1, Math.min(8, padding || 1)), "0")}`;
}
