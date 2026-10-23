import type { StatusOption, Tone } from "@/lib/config-defaults";

/**
 * One status vocabulary per FRS workflow (matches the design's chip sheet). Configurable lists
 * (project / task statuses, pipeline stages, employment statuses) come from settings instead —
 * use `optionTone` / `optionLabel` for those.
 */
type Vocab = Record<string, [label: string, tone: Tone]>;

export const STATUS: Record<string, Vocab> = {
  attendance: {
    present: ["Present", "green"],
    late: ["Late", "amber"],
    half_day: ["Half day", "amber"],
    early: ["Early departure", "amber"],
    absent: ["Absent", "red"],
    on_leave: ["On leave", "blue"],
    missing_checkout: ["Missing check-out", "orange"],
    holiday: ["Holiday", "gray"],
    weekend: ["Weekend", "gray"],
    not_checked_in: ["Not checked in", "gray"],
  },
  movement: {
    draft: ["Draft", "gray"],
    out: ["Out", "orange"],
    returned: ["Returned", "green"],
    overdue: ["Overdue", "red"],
    missing_in: ["Missing In-Time", "purple"],
    cancelled: ["Cancelled", "gray"],
  },
  movementApproval: {
    not_required: ["No approval needed", "gray"],
    pending: ["Pending approval", "amber"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    correction_requested: ["Correction requested", "purple"],
  },
  leave: {
    pending_manager: ["Pending manager", "amber"],
    pending_hr: ["Pending HR", "amber"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    cancelled: ["Cancelled", "gray"],
  },
  correction: {
    pending: ["Pending", "amber"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    cancelled: ["Cancelled", "gray"],
  },
  timesheet: {
    draft: ["Draft", "gray"],
    submitted: ["Submitted", "blue"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
  },
  priority: {
    urgent: ["Urgent", "red"],
    high: ["High", "orange"],
    medium: ["Medium", "amber"],
    low: ["Low", "gray"],
  },
  issue: {
    open: ["Open", "red"],
    assigned: ["Assigned", "purple"],
    in_progress: ["In progress", "blue"],
    fixed: ["Fixed", "green"],
    ready_for_testing: ["Ready for testing", "amber"],
    reopened: ["Reopened", "red"],
    verified: ["Verified", "green"],
    closed: ["Closed", "gray"],
  },
  severity: {
    critical: ["Critical", "red"],
    major: ["Major", "orange"],
    minor: ["Minor", "amber"],
    trivial: ["Trivial", "gray"],
  },
  invoice: {
    draft: ["Draft", "gray"],
    issued: ["Issued", "blue"],
    partially_paid: ["Partially paid", "amber"],
    paid: ["Paid", "green"],
    overdue: ["Overdue", "red"],
    cancelled: ["Cancelled", "gray"],
  },
  payment: {
    payment: ["Payment", "green"],
    refund: ["Refund", "red"],
    adjustment: ["Adjustment", "purple"],
  },
  proposal: {
    draft: ["Draft", "gray"],
    sent: ["Sent", "blue"],
    negotiation: ["Negotiation", "amber"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    expired: ["Expired", "gray"],
    converted: ["Converted", "purple"],
  },
  contract: {
    draft: ["Draft", "gray"],
    active: ["Active", "green"],
    expired: ["Expired", "red"],
    terminated: ["Terminated", "gray"],
    renewed: ["Renewed", "blue"],
  },
  expense: {
    draft: ["Draft", "gray"],
    submitted: ["Submitted", "blue"],
    approved: ["Approved", "green"],
    rejected: ["Rejected", "red"],
    paid: ["Paid", "green"],
  },
  payrollRun: {
    draft: ["Draft", "gray"],
    verified: ["Verified", "blue"],
    approved: ["Approved", "purple"],
    paid: ["Paid", "green"],
    cancelled: ["Cancelled", "gray"],
  },
  payslip: {
    draft: ["Draft", "gray"],
    approved: ["Approved", "purple"],
    paid: ["Paid", "green"],
    on_hold: ["On hold", "amber"],
  },
  asset: {
    available: ["Available", "green"],
    assigned: ["Assigned", "blue"],
    in_repair: ["In repair", "amber"],
    damaged: ["Damaged", "orange"],
    lost: ["Lost", "red"],
    retired: ["Retired", "gray"],
  },
  assetCondition: {
    new: ["New", "green"],
    good: ["Good", "green"],
    fair: ["Fair", "amber"],
    poor: ["Poor", "orange"],
    damaged: ["Damaged", "red"],
  },
  internship: {
    registered: ["Registered", "gray"],
    active: ["Active", "blue"],
    extended: ["Extended", "amber"],
    completed: ["Completed", "green"],
    terminated: ["Terminated", "red"],
  },
  certificate: {
    none: ["Not requested", "gray"],
    requested: ["Requested", "amber"],
    approved: ["Approved", "purple"],
    issued: ["Issued", "green"],
  },
  client: {
    lead: ["Lead", "gray"],
    prospect: ["Prospect", "blue"],
    active: ["Active", "green"],
    inactive: ["Inactive", "gray"],
    lost: ["Lost", "red"],
  },
  leadStatus: {
    open: ["Open", "blue"],
    won: ["Won", "green"],
    lost: ["Lost", "red"],
  },
  milestone: {
    pending: ["Pending", "gray"],
    in_progress: ["In progress", "blue"],
    client_review: ["Client review", "orange"],
    approved: ["Approved", "purple"],
    delivered: ["Delivered", "green"],
    delayed: ["Delayed", "red"],
  },
  submission: {
    pending: ["Awaiting review", "amber"],
    approved: ["Approved", "green"],
    changes_requested: ["Changes requested", "orange"],
  },
  review: {
    draft: ["Draft", "gray"],
    shared: ["Shared", "green"],
  },
  objective: {
    open: ["Open", "gray"],
    in_progress: ["In progress", "blue"],
    achieved: ["Achieved", "green"],
    dropped: ["Dropped", "gray"],
  },
  personType: {
    employee: ["Employee", "blue"],
    trainee: ["Trainee", "purple"],
    intern: ["Intern", "purple"],
    admin: ["Admin", "gray"],
  },
  account: {
    active: ["Login enabled", "green"],
    inactive: ["No access", "gray"],
  },
};

export type StatusDomain = keyof typeof STATUS;

export function statusLabel(domain: string, value: string | null | undefined): string {
  if (!value) return "—";
  return STATUS[domain]?.[value]?.[0] ?? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function statusTone(domain: string, value: string | null | undefined): Tone {
  if (!value) return "gray";
  return STATUS[domain]?.[value]?.[1] ?? "gray";
}

export function optionLabel(options: StatusOption[], key: string | null | undefined): string {
  if (!key) return "—";
  return options.find((o) => o.key === key)?.label ?? key.replace(/_/g, " ");
}

export function optionTone(options: StatusOption[], key: string | null | undefined): Tone {
  return options.find((o) => o.key === key)?.tone ?? "gray";
}

export const TONE_CLASSES: Record<Tone, { bg: string; fg: string; dot: string }> = {
  blue: { bg: "bg-tone-blue-bg", fg: "text-tone-blue", dot: "bg-tone-blue" },
  green: { bg: "bg-tone-green-bg", fg: "text-tone-green", dot: "bg-tone-green" },
  amber: { bg: "bg-tone-amber-bg", fg: "text-tone-amber", dot: "bg-tone-amber" },
  red: { bg: "bg-tone-red-bg", fg: "text-tone-red", dot: "bg-tone-red" },
  orange: { bg: "bg-tone-orange-bg", fg: "text-tone-orange", dot: "bg-tone-orange" },
  gray: { bg: "bg-tone-gray-bg", fg: "text-tone-gray", dot: "bg-tone-gray" },
  purple: { bg: "bg-tone-purple-bg", fg: "text-tone-purple", dot: "bg-tone-purple" },
};
