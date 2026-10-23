import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { can, getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { exportResponse, isExportFormat } from "@/lib/export";
import { Department, Designation, Role, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { optionLabel, statusLabel } from "@/lib/status";
import { namesFor } from "@/lib/people";
import { fmtDate } from "@/lib/time";
import { employmentTypeLabel } from "../_lib/constants";
import { staffFilter } from "../_lib/directory";

/** Staff directory export. Never includes salary, bank or other confidential fields. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "staff.view") || !(can(user, "reports.export") || can(user, "staff.edit"))) {
    return new Response("You don't have permission to export the staff directory.", { status: 403 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isExportFormat(format)) return new Response("Unknown export format", { status: 400 });

  const settings = await getSettings();
  const sp = Object.fromEntries(url.searchParams.entries());
  const users = await db()
    .select({
      employeeId: User.employeeId,
      name: User.name,
      email: User.email,
      phone: User.phone,
      personType: User.personType,
      role: User.role,
      department: User.department,
      designation: User.designation,
      employmentType: User.employmentType,
      joiningDate: User.joiningDate,
      status: User.status,
      reportingManager: User.reportingManager,
      accountActive: User.accountActive,
    })
    .from(User)
    .where(staffFilter(sp, settings))
    .orderBy(asc(User.name))
    .limit(5000);

  const [departments, designations, roles, managers] = await Promise.all([
    db().select({ _id: Department._id, name: Department.name }).from(Department),
    db().select({ _id: Designation._id, name: Designation.name }).from(Designation),
    db().select({ key: Role.key, name: Role.name }).from(Role),
    namesFor(users.map((u) => u.reportingManager)),
  ]);
  const dept = new Map(departments.map((d) => [d._id, d.name]));
  const desig = new Map(designations.map((d) => [d._id, d.name]));
  const role = new Map(roles.map((r) => [r.key, r.name]));

  await audit(user, { action: "export", entity: "user", summary: `Exported staff directory (${users.length} records, ${format})` });

  return exportResponse({
    title: "Staff directory",
    filename: "staff-directory",
    format,
    rows: users,
    columns: [
      { header: "Employee ID", value: (u) => u.employeeId, width: 14 },
      { header: "Name", value: (u) => u.name, width: 26 },
      { header: "Work email", value: (u) => u.email, width: 30 },
      { header: "Phone", value: (u) => u.phone ?? "", width: 16 },
      { header: "Type", value: (u) => statusLabel("personType", u.personType), width: 11 },
      { header: "Role", value: (u) => role.get(u.role) ?? u.role, width: 18 },
      { header: "Department", value: (u) => (u.department ? dept.get(u.department) : "") ?? "", width: 20 },
      { header: "Designation", value: (u) => (u.designation ? desig.get(u.designation) : "") ?? "", width: 22 },
      { header: "Employment", value: (u) => employmentTypeLabel(u.employmentType), width: 13 },
      { header: "Joined", value: (u) => fmtDate(u.joiningDate), width: 13 },
      { header: "Status", value: (u) => optionLabel(settings.employmentStatuses, u.status), width: 14 },
      { header: "Reports to", value: (u) => (u.reportingManager ? managers.get(u.reportingManager) : "") ?? "", width: 22 },
      { header: "Login access", value: (u) => (u.accountActive ? "Enabled" : "Off"), width: 12 },
    ],
  });
}
