/**
 * Shapes and factory defaults for everything the Super Admin can configure (FRS §21).
 * Shared by server and client. Stored in the singleton `Settings` document.
 */
export type Tone = "blue" | "green" | "amber" | "red" | "orange" | "gray" | "purple";

export interface StatusOption<C extends string = string> {
  key: string;
  label: string;
  tone: Tone;
  category: C;
}

export type ProjectStatusCategory = "enquiry" | "planning" | "active" | "hold" | "review" | "completed" | "cancelled";
export type TaskStatusCategory = "open" | "active" | "review" | "blocked" | "done" | "cancelled";
export type PipelineCategory = "open" | "won" | "lost";
export type EmploymentStatusCategory = "active" | "leave" | "notice" | "exited" | "inactive";

export interface MovementCategory {
  key: string;
  label: string;
  official: boolean;
  requiresApproval: boolean;
  active: boolean;
}

export interface DocumentCategory {
  key: string;
  label: string;
  required: boolean;
  appliesTo: string[];
  hasExpiry: boolean;
  confidential: boolean;
}

export interface PayrollComponent {
  key: string;
  name: string;
  type: "earning" | "deduction";
  calc: "fixed" | "percent_basic";
  value: number;
  /** Optional monthly cap for percentage components (e.g. PF on a wage ceiling). */
  cap?: number;
  appliesTo: string[];
  active: boolean;
}

export interface TaxRate {
  name: string;
  rate: number;
}

export interface PaymentTerm {
  label: string;
  days: number;
}

export interface AppSettings {
  company: {
    name: string;
    legalName: string;
    logo?: string;
    address: string;
    email: string;
    phone: string;
    website: string;
    gstin: string;
    pan: string;
  };
  attendance: {
    workingDays: number[];
    officeStart: string;
    officeEnd: string;
    graceMinutes: number;
    earlyLeaveGraceMinutes: number;
    fullDayMinutes: number;
    halfDayMinutes: number;
    missingCheckoutAfter: string;
    officialMovementCountsAsWork: boolean;
    personalMovementDeducted: boolean;
    allowSelfCheckIn: boolean;
    /**
     * First day attendance is recorded in the ERP ("yyyy-MM-dd", empty = always). Working days before it
     * with no attendance record are not treated as absent (e.g. the month the system goes live).
     */
    trackingStartDate: string;
  };
  movement: {
    categories: MovementCategory[];
    overdueGraceMinutes: number;
    requireExpectedReturn: boolean;
    alternativeEntryMaxDays: number;
  };
  leave: {
    yearStartMonth: number;
    allowNegativeBalance: boolean;
    countWeekendsInLeave: boolean;
  };
  payroll: {
    components: PayrollComponent[];
    payDay: number;
    lopBasis: "working_days" | "calendar_days";
  };
  projectStatuses: StatusOption<ProjectStatusCategory>[];
  taskStatuses: StatusOption<TaskStatusCategory>[];
  pipelineStages: (StatusOption<PipelineCategory> & { probability: number })[];
  employmentStatuses: StatusOption<EmploymentStatusCategory>[];
  documentCategories: DocumentCategory[];
  expenseCategories: string[];
  assetCategories: string[];
  leadSources: string[];
  numbering: {
    invoicePrefix: string;
    invoicePadding: number;
    invoiceIncludeFiscalYear: boolean;
    proposalPrefix: string;
    certificatePrefix: string;
  };
  taxes: TaxRate[];
  paymentTerms: PaymentTerm[];
  documents: {
    invoiceNotes: string;
    invoiceTerms: string;
    proposalTerms: string;
    payslipFooter: string;
    certificateText: string;
    bankDetails: string;
  };
  notifications: {
    inApp: boolean;
    email: boolean;
    events: Record<string, boolean>;
    reminderDaysBefore: number;
  };
  data: {
    auditRetentionDays: number;
    notificationRetentionDays: number;
    backupRetentionCount: number;
    autoBackup: boolean;
  };
  security: {
    sessionHours: number;
    rememberDays: number;
  };
}

export const NOTIFICATION_EVENTS: { key: string; label: string }[] = [
  { key: "task", label: "Task assignments, deadlines and reviews" },
  { key: "leave", label: "Leave requests and decisions" },
  { key: "attendance", label: "Attendance irregularities and corrections" },
  { key: "movement", label: "Movement submissions, approvals, overdue and missing In-Time" },
  { key: "timesheet", label: "Timesheet submission and approval" },
  { key: "project", label: "Project milestone reminders" },
  { key: "crm", label: "Client follow-ups" },
  { key: "contract", label: "Proposal and contract expiry" },
  { key: "invoice", label: "Invoice due dates and overdue payments" },
  { key: "payroll", label: "Payroll approvals and payslips" },
  { key: "document", label: "Employee and intern document expiry" },
  { key: "internship", label: "Internship reviews and completion deadlines" },
  { key: "expense", label: "Expense approvals and reimbursements" },
  { key: "asset", label: "Asset warranty and maintenance" },
  { key: "qa", label: "QA issue assignment and status" },
  { key: "announcement", label: "Announcements" },
  { key: "system", label: "System and security" },
];

export const DEFAULT_SETTINGS: AppSettings = {
  company: {
    name: "D4DX Innovations LLP",
    legalName: "D4DX Innovations LLP",
    logo: "/brand/d4dx-logo.png",
    address: "",
    email: "hr@d4dx.co",
    phone: "",
    website: "https://d4dx.co",
    gstin: "",
    pan: "",
  },
  attendance: {
    workingDays: [1, 2, 3, 4, 5],
    officeStart: "09:30",
    officeEnd: "18:30",
    graceMinutes: 15,
    earlyLeaveGraceMinutes: 15,
    fullDayMinutes: 480,
    halfDayMinutes: 240,
    missingCheckoutAfter: "21:00",
    officialMovementCountsAsWork: true,
    personalMovementDeducted: false,
    allowSelfCheckIn: true,
    trackingStartDate: "",
  },
  movement: {
    categories: [
      { key: "client_meeting", label: "Client meeting", official: true, requiresApproval: false, active: true },
      { key: "official_business", label: "Official business", official: true, requiresApproval: false, active: true },
      { key: "project_work", label: "Project-related work", official: true, requiresApproval: false, active: true },
      { key: "personal", label: "Personal work", official: false, requiresApproval: true, active: true },
      { key: "medical", label: "Medical or emergency", official: false, requiresApproval: true, active: true },
      { key: "other", label: "Other authorised purpose", official: true, requiresApproval: true, active: true },
    ],
    overdueGraceMinutes: 10,
    requireExpectedReturn: true,
    alternativeEntryMaxDays: 7,
  },
  leave: {
    yearStartMonth: 1,
    allowNegativeBalance: false,
    countWeekendsInLeave: false,
  },
  payroll: {
    components: [
      { key: "hra", name: "House rent allowance", type: "earning", calc: "percent_basic", value: 40, appliesTo: ["employee"], active: true },
      { key: "conveyance", name: "Conveyance allowance", type: "earning", calc: "fixed", value: 1600, appliesTo: ["employee"], active: false },
      { key: "pf", name: "Provident fund (employee)", type: "deduction", calc: "percent_basic", value: 12, cap: 1800, appliesTo: ["employee"], active: false },
      { key: "pt", name: "Professional tax", type: "deduction", calc: "fixed", value: 200, appliesTo: ["employee"], active: false },
    ],
    payDay: 1,
    lopBasis: "working_days",
  },
  projectStatuses: [
    { key: "enquiry", label: "Enquiry", tone: "gray", category: "enquiry" },
    { key: "planning", label: "Planning", tone: "purple", category: "planning" },
    { key: "in_progress", label: "In progress", tone: "blue", category: "active" },
    { key: "on_hold", label: "On hold", tone: "amber", category: "hold" },
    { key: "under_review", label: "Under review", tone: "orange", category: "review" },
    { key: "completed", label: "Completed", tone: "green", category: "completed" },
    { key: "cancelled", label: "Cancelled", tone: "gray", category: "cancelled" },
  ],
  taskStatuses: [
    { key: "todo", label: "To do", tone: "gray", category: "open" },
    { key: "in_progress", label: "In progress", tone: "blue", category: "active" },
    { key: "in_review", label: "In review", tone: "purple", category: "review" },
    { key: "blocked", label: "Blocked", tone: "red", category: "blocked" },
    { key: "done", label: "Done", tone: "green", category: "done" },
    { key: "cancelled", label: "Cancelled", tone: "gray", category: "cancelled" },
  ],
  pipelineStages: [
    { key: "new", label: "New lead", tone: "gray", category: "open", probability: 5 },
    { key: "contacted", label: "Contacted", tone: "blue", category: "open", probability: 10 },
    { key: "requirement", label: "Requirement gathering", tone: "blue", category: "open", probability: 25 },
    { key: "proposal_prep", label: "Proposal preparation", tone: "purple", category: "open", probability: 40 },
    { key: "proposal_sent", label: "Proposal sent", tone: "purple", category: "open", probability: 55 },
    { key: "negotiation", label: "Negotiation", tone: "amber", category: "open", probability: 75 },
    { key: "won", label: "Won", tone: "green", category: "won", probability: 100 },
    { key: "lost", label: "Lost", tone: "red", category: "lost", probability: 0 },
  ],
  employmentStatuses: [
    { key: "active", label: "Active", tone: "green", category: "active" },
    { key: "on_leave", label: "On leave", tone: "blue", category: "leave" },
    { key: "notice", label: "Notice period", tone: "amber", category: "notice" },
    { key: "resigned", label: "Resigned", tone: "gray", category: "exited" },
    { key: "terminated", label: "Terminated", tone: "red", category: "exited" },
    { key: "inactive", label: "Inactive", tone: "gray", category: "inactive" },
  ],
  documentCategories: [
    { key: "id_proof", label: "ID proof (Aadhaar / Passport)", required: true, appliesTo: ["employee", "trainee", "intern"], hasExpiry: false, confidential: true },
    { key: "pan", label: "PAN card", required: true, appliesTo: ["employee", "trainee"], hasExpiry: false, confidential: true },
    { key: "address_proof", label: "Address proof", required: true, appliesTo: ["employee", "trainee", "intern"], hasExpiry: false, confidential: true },
    { key: "offer_letter", label: "Offer / appointment letter", required: true, appliesTo: ["employee", "trainee", "intern"], hasExpiry: false, confidential: true },
    { key: "agreement", label: "Employment agreement / NDA", required: true, appliesTo: ["employee", "trainee", "intern"], hasExpiry: true, confidential: true },
    { key: "education", label: "Educational certificates", required: false, appliesTo: ["employee", "trainee", "intern"], hasExpiry: false, confidential: false },
    { key: "experience", label: "Experience / relieving letters", required: false, appliesTo: ["employee"], hasExpiry: false, confidential: true },
    { key: "college_letter", label: "College internship letter", required: true, appliesTo: ["intern"], hasExpiry: false, confidential: false },
    { key: "bank", label: "Bank details proof", required: false, appliesTo: ["employee", "trainee", "intern"], hasExpiry: false, confidential: true },
    { key: "other", label: "Other", required: false, appliesTo: ["employee", "trainee", "intern"], hasExpiry: true, confidential: false },
  ],
  expenseCategories: ["Travel", "Client meeting", "Software & subscriptions", "Hardware", "Office supplies", "Internet & phone", "Marketing", "Training", "Utilities", "Rent", "Other"],
  assetCategories: ["Laptop", "Desktop", "Monitor", "Mobile phone", "Tablet", "Peripheral", "Furniture", "Network equipment", "Software licence", "Other"],
  leadSources: ["Website", "Referral", "LinkedIn", "Cold outreach", "Existing client", "Event", "Partner", "Other"],
  numbering: {
    invoicePrefix: "INV-",
    invoicePadding: 4,
    invoiceIncludeFiscalYear: true,
    proposalPrefix: "PRP-",
    certificatePrefix: "D4DX/INT/",
  },
  taxes: [
    { name: "No tax", rate: 0 },
    { name: "GST 18%", rate: 18 },
    { name: "GST 12%", rate: 12 },
    { name: "GST 5%", rate: 5 },
  ],
  paymentTerms: [
    { label: "Due on receipt", days: 0 },
    { label: "Net 7", days: 7 },
    { label: "Net 15", days: 15 },
    { label: "Net 30", days: 30 },
    { label: "Net 45", days: 45 },
  ],
  documents: {
    invoiceNotes: "Thank you for your business.",
    invoiceTerms: "Payment is due by the due date shown. Please quote the invoice number with your payment.",
    proposalTerms: "This proposal is valid until the date shown. Prices exclude applicable taxes unless stated.",
    payslipFooter: "This is a system-generated payslip and does not require a signature.",
    certificateText:
      "This is to certify that {name} has successfully completed an internship with {company} as {role} from {start} to {end}. During the internship, {firstName} showed commitment, a willingness to learn and contributed to the work of the team. We wish {firstName} every success.",
    bankDetails: "",
  },
  notifications: {
    inApp: true,
    email: false,
    events: Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e.key, true])),
    reminderDaysBefore: 7,
  },
  data: {
    auditRetentionDays: 1095,
    notificationRetentionDays: 180,
    backupRetentionCount: 14,
    autoBackup: true,
  },
  security: {
    sessionHours: 12,
    rememberDays: 30,
  },
};
