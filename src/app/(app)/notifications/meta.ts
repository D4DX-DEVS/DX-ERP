import type { Tone } from "@/lib/config-defaults";

/** Short labels and colours for notification categories (keys match NOTIFICATION_EVENTS). */
export const NOTIFICATION_TYPES: Record<string, { label: string; tone: Tone }> = {
  task: { label: "Tasks", tone: "blue" },
  leave: { label: "Leave", tone: "blue" },
  attendance: { label: "Attendance", tone: "amber" },
  movement: { label: "Movement", tone: "orange" },
  timesheet: { label: "Timesheets", tone: "purple" },
  project: { label: "Projects", tone: "blue" },
  crm: { label: "Sales", tone: "purple" },
  contract: { label: "Contracts", tone: "amber" },
  invoice: { label: "Invoices", tone: "green" },
  payroll: { label: "Payroll", tone: "green" },
  document: { label: "Documents", tone: "gray" },
  internship: { label: "Internship", tone: "purple" },
  expense: { label: "Expenses", tone: "green" },
  asset: { label: "Assets", tone: "gray" },
  qa: { label: "QA", tone: "red" },
  announcement: { label: "Announcements", tone: "blue" },
  system: { label: "System", tone: "gray" },
};

export function notificationType(type: string): { label: string; tone: Tone } {
  return NOTIFICATION_TYPES[type] ?? { label: type.replace(/_/g, " "), tone: "gray" };
}

/** Only app-relative links are followed from a notification (guards against open redirects). */
export function safeLink(link: string | undefined | null): string | undefined {
  return link && link.startsWith("/") && !link.startsWith("//") ? link : undefined;
}

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  actionable: boolean;
  high: boolean;
  time: string;
}

export interface NotificationGroup {
  label: string;
  items: NotificationView[];
}
