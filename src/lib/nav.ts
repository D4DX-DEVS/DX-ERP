import { can, canAny, isStaff, type CurrentUser } from "@/lib/auth/session";

/** Icon keys resolved to lucide icons in the client shell. */
export type NavIcon =
  | "dashboard"
  | "staff"
  | "interns"
  | "attendance"
  | "movement"
  | "leave"
  | "timesheets"
  | "projects"
  | "tasks"
  | "qa"
  | "crm"
  | "proposals"
  | "contracts"
  | "invoices"
  | "expenses"
  | "payroll"
  | "payslips"
  | "learning"
  | "assets"
  | "reports"
  | "settings"
  | "roles"
  | "audit"
  | "notifications"
  | "profile";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  badge?: number;
  badgeTone?: "alert" | "muted";
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavContext {
  user: CurrentUser;
  isManager: boolean;
  isMentor: boolean;
  badges: Partial<Record<string, { count: number; tone?: "alert" | "muted" }>>;
}

/**
 * Builds the sidebar for the signed-in user. Mirrors the design's role-filtered navigation:
 * management / HR see organisation modules, employees and interns see self-service sections.
 */
export function buildNav({ user, isManager, isMentor, badges }: NavContext): NavSection[] {
  const staff = isStaff(user);
  const intern = user.personType === "intern" || user.personType === "trainee";
  const item = (key: string, label: string, href: string, icon: NavIcon): NavItem => ({
    key,
    label,
    href,
    icon,
    badge: badges[key]?.count || undefined,
    badgeTone: badges[key]?.tone,
  });

  const sections: NavSection[] = [{ label: "", items: [item("dashboard", "Dashboard", "/dashboard", "dashboard")] }];

  const people: NavItem[] = [];
  if (can(user, "staff.view")) people.push(item("staff", "Staff", "/staff", "staff"));
  if (canAny(user, ["staff.view", "interns.manage", "interns.review"]) || isMentor) people.push(item("interns", "Interns & trainees", "/interns", "interns"));
  if (people.length) sections.push({ label: "People", items: people });

  const time: NavItem[] = [];
  if (staff || can(user, "attendance.view_all")) time.push(item("attendance", "Attendance", "/attendance", "attendance"));
  if (staff || canAny(user, ["movement.view_all", "movement.approve"])) time.push(item("movement", "Movement register", "/movement", "movement"));
  if (staff || canAny(user, ["leave.view_all", "leave.approve"])) time.push(item("leave", "Leave", "/leave", "leave"));
  if (staff || canAny(user, ["timesheets.view_all", "timesheets.approve"]) || isManager) time.push(item("timesheets", "Timesheets", "/timesheets", "timesheets"));
  if (time.length) sections.push({ label: intern ? "My time" : staff && !can(user, "attendance.view_all") ? "My time" : "Time", items: time });

  const work: NavItem[] = [];
  work.push(item("tasks", intern ? "My tasks" : "Tasks", "/tasks", "tasks"));
  if (!intern || can(user, "projects.view_all")) work.push(item("projects", "Projects", "/projects", "projects"));
  if (!intern || can(user, "qa.view_all")) work.push(item("qa", "QA & issues", "/qa", "qa"));
  if (intern || canAny(user, ["interns.manage"])) work.push(item("learning", intern ? "Learning & reviews" : "Learning", "/learning", "learning"));
  sections.push({ label: intern ? "Internship" : "Work", items: work });

  const sales: NavItem[] = [];
  if (can(user, "crm.view")) sales.push(item("crm", "Leads & clients", "/crm", "crm"));
  if (can(user, "proposals.view")) sales.push(item("proposals", "Proposals", "/proposals", "proposals"));
  if (can(user, "contracts.view")) sales.push(item("contracts", "Contracts", "/contracts", "contracts"));
  if (sales.length) sections.push({ label: "Sales", items: sales });

  const finance: NavItem[] = [];
  if (can(user, "invoices.view")) finance.push(item("invoices", "Invoices & payments", "/invoices", "invoices"));
  if (staff || canAny(user, ["expenses.view_all", "expenses.approve"]))
    finance.push(item("expenses", canAny(user, ["expenses.view_all", "expenses.approve"]) ? "Expenses" : "My expenses", "/expenses", "expenses"));
  if (can(user, "payroll.view")) finance.push(item("payroll", "Payroll & stipends", "/payroll", "payroll"));
  if (staff) finance.push(item("payslips", intern ? "My stipend" : "My payslips", "/payslips", "payslips"));
  if (finance.length) sections.push({ label: can(user, "invoices.view") || can(user, "payroll.view") ? "Finance" : "Pay & claims", items: finance });

  const ops: NavItem[] = [];
  if (can(user, "assets.view")) ops.push(item("assets", "Assets", "/assets", "assets"));
  if (can(user, "reports.view")) ops.push(item("reports", "Reports", "/reports", "reports"));
  if (ops.length) sections.push({ label: "Operations", items: ops });

  const admin: NavItem[] = [];
  if (canAny(user, ["settings.manage", "backup.manage"])) admin.push(item("settings", "Configuration", "/settings", "settings"));
  if (canAny(user, ["roles.manage", "users.manage"])) admin.push(item("roles", "Roles & access", "/roles", "roles"));
  if (can(user, "audit.view")) admin.push(item("audit", "Audit trail", "/audit", "audit"));
  if (admin.length) sections.push({ label: "Admin", items: admin });

  return sections;
}
