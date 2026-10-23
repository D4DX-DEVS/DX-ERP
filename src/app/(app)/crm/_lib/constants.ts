import type { ActivityType } from "@/lib/models/crm";

/** Activity types that can be logged or scheduled from the composer. */
export const COMPOSER_TYPES: { key: ActivityType; label: string }[] = [
  { key: "call", label: "Call" },
  { key: "meeting", label: "Meeting" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "note", label: "Note" },
  { key: "follow_up", label: "Follow-up" },
];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  call: "Call",
  meeting: "Meeting",
  email: "Email",
  whatsapp: "WhatsApp",
  note: "Note",
  follow_up: "Follow-up",
};

/** Common reasons offered when a lead is marked lost (a note can be added on top). */
export const LOST_REASONS = [
  "Budget too low",
  "Chose a competitor",
  "No response from client",
  "Requirement changed or dropped",
  "Timeline mismatch",
  "Out of scope for us",
  "Project cancelled or on hold",
  "Other",
];

export const CLIENT_TYPES = [
  { value: "company", label: "Company" },
  { value: "individual", label: "Individual" },
];

export const CLIENT_STATUS_VALUES = ["lead", "prospect", "active", "inactive", "lost"] as const;
