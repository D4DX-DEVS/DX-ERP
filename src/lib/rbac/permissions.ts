/**
 * Permission catalog (FRS §3.2). Self-service actions on a user's *own* records
 * (own attendance, movements, leave, assigned tasks, timesheets, profile, expense claims)
 * are always allowed and are not listed here. Reporting managers can additionally review
 * and approve their direct reports' leave, movements, attendance corrections and timesheets.
 * Permissions below grant organisation-wide access and administrative actions.
 */
export const PERMISSION_GROUPS = [
  {
    module: "People",
    items: [
      ["staff.view", "View staff directory and profiles"],
      ["staff.create", "Add employees, trainees and interns"],
      ["staff.edit", "Edit records, lifecycle events and documents"],
      ["staff.delete", "Delete staff records"],
      ["staff.confidential", "View salary, bank details and confidential documents"],
      ["users.manage", "Activate / deactivate login access and assign roles"],
      ["interns.manage", "Manage internships, objectives and certificates"],
      ["interns.review", "Record evaluations and feedback for any intern"],
    ],
  },
  {
    module: "Time",
    items: [
      ["attendance.view_all", "View everyone's attendance"],
      ["attendance.manage", "Manual attendance entry and edits"],
      ["attendance.approve", "Approve attendance corrections"],
      ["movement.view_all", "View the movement register"],
      ["movement.view_personal", "See details of personal movements"],
      ["movement.approve", "Approve movements and movement corrections"],
      ["movement.manage", "Alternative entry and resolving open movements"],
      ["leave.view_all", "View all leave and the team calendar"],
      ["leave.approve", "HR / management leave approval"],
      ["leave.manage", "Adjust leave balances and allocations"],
      ["timesheets.view_all", "View all timesheets"],
      ["timesheets.approve", "Approve or reject any timesheet"],
    ],
  },
  {
    module: "Work",
    items: [
      ["projects.view_all", "View all projects"],
      ["projects.manage", "Create and edit projects, milestones and teams"],
      ["projects.delete", "Delete or cancel projects"],
      ["projects.financials", "View project budgets, billing and costs"],
      ["tasks.view_all", "View all tasks"],
      ["tasks.manage", "Create, assign and reassign tasks"],
      ["tasks.review", "Review submitted work on any task"],
      ["qa.view_all", "View all QA issues"],
      ["qa.manage", "Create and assign issues"],
      ["qa.verify", "Verify fixes, reopen and close issues"],
      ["qa.projects", "Open every project's overview and QA issues (no tasks, files or secrets)"],
    ],
  },
  {
    module: "Sales",
    items: [
      ["crm.view", "View clients, leads and communication"],
      ["crm.manage", "Create and edit clients, leads and follow-ups"],
      ["crm.delete", "Delete clients and leads"],
      ["crm.confidential", "View restricted client information"],
      ["proposals.view", "View proposals and quotations"],
      ["proposals.manage", "Create and revise proposals"],
      ["proposals.approve", "Approve proposals and convert to projects"],
      ["contracts.view", "View contracts"],
      ["contracts.manage", "Upload and manage contracts"],
    ],
  },
  {
    module: "Finance",
    items: [
      ["invoices.view", "View invoices and receivables"],
      ["invoices.manage", "Create, issue and cancel invoices"],
      ["invoices.payments", "Record payments, refunds and adjustments"],
      ["expenses.view_all", "View all expenses"],
      ["expenses.approve", "Approve or reject expenses"],
      ["expenses.pay", "Record expense payments and reimbursements"],
      ["payroll.view", "View payroll and stipend runs"],
      ["payroll.prepare", "Prepare payroll and stipend runs"],
      ["payroll.approve", "Approve payroll and stipend runs"],
      ["payroll.pay", "Record salary and stipend payments"],
    ],
  },
  {
    module: "Operations",
    items: [
      ["assets.view", "View assets and allocations"],
      ["assets.manage", "Add, issue, return and retire assets"],
      ["reports.view", "Open operational reports"],
      ["reports.hr", "HR, attendance and movement reports"],
      ["reports.financial", "Financial and payroll reports"],
      ["reports.export", "Export reports to Excel, CSV and PDF"],
      ["announcements.manage", "Publish announcements"],
    ],
  },
  {
    module: "Administration",
    items: [
      ["settings.manage", "Configure company, policies and workflows"],
      ["roles.manage", "Edit roles and permissions"],
      ["audit.view", "View the audit trail"],
      ["backup.manage", "Run backups and restore data"],
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["items"][number][0];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i[0]));

/**
 * Held only by the super admin, whatever a role says: everyone else sees just the projects (and their tasks) they lead or
 * are on, and nobody else deletes or cancels projects. `effectivePermissions` strips these from every other role.
 */
export const SUPER_ADMIN_ONLY: Permission[] = ["projects.view_all", "projects.delete", "tasks.view_all"];

/** The QA Engineer role: tests every project and is the one who signs off bug fixes. */
export const QA_ROLE = "qa_engineer";

/** Held only by the QA Engineer role (and the super admin): nobody else verifies or closes fixes. */
export const QA_ROLE_ONLY: Permission[] = ["qa.verify", "qa.projects"];

/** Permissions a role can never hold, whatever its stored list says. */
export function reservedPermissions(roleKey: string): Permission[] {
  if (roleKey === "super_admin") return [];
  return roleKey === QA_ROLE ? SUPER_ADMIN_ONLY : [...SUPER_ADMIN_ONLY, ...QA_ROLE_ONLY];
}

export const PERMISSION_LABELS: Record<Permission, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => [i[0], i[1]])),
) as Record<Permission, string>;

/** Built-in roles (FRS §3.1). `super_admin` is reserved for the single env-configured account. */
export const ROLE_KEYS = [
  "super_admin",
  "management",
  "hr",
  "finance",
  "bd",
  "pm",
  "team_lead",
  "qa_engineer",
  "employee",
  "trainee",
  "intern",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  management: "Management",
  hr: "HR / Admin",
  finance: "Finance / Accounts",
  bd: "Business Development",
  pm: "Project Manager",
  team_lead: "Team Lead",
  qa_engineer: "QA Engineer",
  employee: "Employee",
  trainee: "Trainee",
  intern: "Intern",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  super_admin: "Complete system configuration, user management and access control",
  management: "Organisation-wide oversight, approvals, dashboards and reports",
  hr: "Employee and intern records, attendance, movement register, leave and HR administration",
  finance: "Payroll, stipends, invoices, payments, expenses and financial reports",
  bd: "Leads, enquiries, proposals, quotations and client follow-ups",
  pm: "Project planning, resource allocation, task assignments, milestones and delivery",
  team_lead: "Team coordination, task monitoring, timesheet review and assigned approvals",
  qa_engineer: "Reports bugs on every project, verifies fixes and closes issues; sees each project's overview and QA issues only",
  employee: "Own profile, attendance, movements, leave, assigned tasks and timesheets",
  trainee: "Assigned tasks, attendance, training activities and permitted project information",
  intern: "Internship records, attendance, movements, tasks, learning, submissions and feedback",
};

const without = (list: Permission[], remove: Permission[]) => list.filter((p) => !remove.includes(p));

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  management: without(ALL_PERMISSIONS, ["settings.manage", "roles.manage", "backup.manage", "users.manage", ...SUPER_ADMIN_ONLY, ...QA_ROLE_ONLY]),
  hr: [
    "staff.view",
    "staff.create",
    "staff.edit",
    "staff.confidential",
    "interns.manage",
    "interns.review",
    "attendance.view_all",
    "attendance.manage",
    "attendance.approve",
    "movement.view_all",
    "movement.view_personal",
    "movement.approve",
    "movement.manage",
    "leave.view_all",
    "leave.approve",
    "leave.manage",
    "timesheets.view_all",
    "payroll.view",
    "payroll.prepare",
    "expenses.view_all",
    "assets.view",
    "assets.manage",
    "reports.view",
    "reports.hr",
    "reports.export",
    "announcements.manage",
    "audit.view",
  ],
  finance: [
    "staff.view",
    "staff.confidential",
    "projects.financials",
    "crm.view",
    "proposals.view",
    "contracts.view",
    "invoices.view",
    "invoices.manage",
    "invoices.payments",
    "expenses.view_all",
    "expenses.approve",
    "expenses.pay",
    "payroll.view",
    "payroll.prepare",
    "payroll.pay",
    "assets.view",
    "reports.view",
    "reports.financial",
    "reports.export",
  ],
  bd: [
    "crm.view",
    "crm.manage",
    "proposals.view",
    "proposals.manage",
    "contracts.view",
    "contracts.manage",
    "reports.view",
    "reports.export",
  ],
  pm: [
    "staff.view",
    "interns.review",
    "projects.manage",
    "projects.financials",
    "tasks.manage",
    "tasks.review",
    "timesheets.view_all",
    "timesheets.approve",
    "qa.view_all",
    "qa.manage",
    "crm.view",
    "proposals.view",
    "contracts.view",
    "reports.view",
    "reports.export",
  ],
  team_lead: [
    "staff.view",
    "interns.review",
    "projects.manage",
    "tasks.manage",
    "tasks.review",
    "timesheets.approve",
    "qa.manage",
    "reports.view",
  ],
  qa_engineer: ["qa.view_all", "qa.manage", "qa.verify", "qa.projects"],
  employee: [],
  trainee: [],
  intern: [],
};

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}
