import { NextResponse } from "next/server";
import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { can, getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Department, Movement, Project, User, type IMovement } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { directReportIds } from "@/lib/people";
import { displayStatus, movementScope, scopeFilter } from "@/lib/movement/access";
import { exportResponse, isExportFormat } from "@/lib/export";
import { audit } from "@/lib/audit";
import { inList, searchAny } from "@/lib/sql";
import { fmtDate, fmtDateTime, formatDuration, todayKey } from "@/lib/time";
import { statusLabel } from "@/lib/status";
import { isObjectId } from "@/lib/validation";

/** Movement register export (FRS §8.9) honouring the register filters and personal-detail restrictions. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const scope = await movementScope(user);
  if (scope.kind === "self" || !can(user, "reports.export")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const url = new URL(request.url);
  const sp = url.searchParams;
  const format = sp.get("format");
  if (!isExportFormat(format)) return NextResponse.json({ error: "Unknown format" }, { status: 400 });

  const settings = await getSettings();
  const today = todayKey();
  const valid = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = valid(sp.get("from")) ?? today;
  const to = valid(sp.get("to")) ?? from;
  const department = sp.get("department");
  const q = sp.get("q")?.trim().slice(0, 100);
  let personIds: string[] | undefined;
  if ((department && isObjectId(department)) || q) {
    const found = await db()
      .select({ id: User._id })
      .from(User)
      .where(and(department && isObjectId(department) ? eq(User.department, department) : undefined, q ? searchAny(q, User.name, User.employeeId) : undefined));
    const ids = found.map((u) => u.id);
    personIds = scope.kind === "team" ? ids.filter((id) => scope.userIds.includes(id)) : ids;
  }
  const category = sp.get("category");
  const approval = sp.get("approval");
  const status = sp.get("status");
  const filter = and(
    scopeFilter(user, scope),
    status === "missing_in"
      ? and(lt(Movement.date, today), gte(Movement.date, from))
      : and(gte(Movement.date, from <= to ? from : to), lte(Movement.date, from <= to ? to : from)),
    personIds ? inList(Movement.user, personIds) : undefined,
    category ? eq(Movement.category, category) : undefined,
    approval ? eq(Movement.approvalStatus, approval as IMovement["approvalStatus"]) : undefined,
    status === "returned" || status === "cancelled" || status === "out" ? eq(Movement.status, status) : undefined,
    status === "overdue" || status === "missing_in" ? eq(Movement.status, "out") : undefined,
    status === "overdue" ? lt(Movement.expectedReturn, new Date(Date.now() - settings.movement.overdueGraceMinutes * 60_000)) : undefined,
  );

  const rows = await db().select().from(Movement).where(filter).orderBy(asc(Movement.date), asc(Movement.outTime)).limit(20_000);
  const [people, projects, clients, reports] = await Promise.all([
    db()
      .select({ _id: User._id, name: User.name, employeeId: User.employeeId, deptName: Department.name })
      .from(User)
      .leftJoin(Department, eq(Department._id, User.department))
      .where(inList(User._id, [...new Set(rows.map((r) => r.user))])),
    db()
      .select({ _id: Project._id, projectNo: Project.projectNo })
      .from(Project)
      .where(inList(Project._id, [...new Set(rows.map((r) => r.project).filter((x): x is string => Boolean(x)))])),
    db()
      .select({ _id: Client._id, clientNo: Client.clientNo })
      .from(Client)
      .where(inList(Client._id, [...new Set(rows.map((r) => r.client).filter((x): x is string => Boolean(x)))])),
    directReportIds(user._id),
  ]);
  const person = new Map(people.map((p) => [p._id, p]));
  const proj = new Map(projects.map((p) => [p._id, p.projectNo]));
  const cli = new Map(clients.map((c) => [c._id, c.clientNo]));
  const reportSet = new Set(reports);
  const showPersonal = (m: IMovement) => m.official || m.user === user.id || reportSet.has(m.user) || can(user, "movement.view_personal");

  await audit(user, { action: "export", entity: "movement", summary: `Exported movement register ${from} – ${to} (${rows.length} rows, ${format})` });

  return exportResponse({
    title: "Movement register",
    filename: "movement-register",
    format,
    subtitle: `${fmtDate(from)} – ${fmtDate(to)}`,
    rows,
    columns: [
      { header: "Movement ID", value: (m) => m.movementNo, width: 14 },
      { header: "Date", value: (m) => m.date, width: 12 },
      { header: "Employee ID", value: (m) => person.get(m.user)?.employeeId, width: 12 },
      { header: "Name", value: (m) => person.get(m.user)?.name, width: 22 },
      { header: "Department", value: (m) => person.get(m.user)?.deptName ?? "", width: 18 },
      { header: "Category", value: (m) => (showPersonal(m) ? m.categoryLabel : "Personal"), width: 18 },
      { header: "Type", value: (m) => (m.official ? "Official" : "Personal"), width: 10 },
      { header: "Purpose", value: (m) => (showPersonal(m) ? m.purpose : "Personal"), width: 30 },
      { header: "Destination", value: (m) => (showPersonal(m) ? m.destination : ""), width: 24 },
      { header: "Reference", value: (m) => (m.project && proj.get(m.project)) || (m.client && cli.get(m.client)) || "", width: 12 },
      { header: "Out-Time", value: (m) => fmtDateTime(m.outTime), width: 18 },
      { header: "Expected return", value: (m) => fmtDateTime(m.expectedReturn), width: 18 },
      { header: "In-Time", value: (m) => (m.inTime ? fmtDateTime(m.inTime) : ""), width: 18 },
      { header: "Minutes outside", value: (m) => m.durationMinutes ?? "", type: "number", width: 10 },
      { header: "Time outside", value: (m) => (m.durationMinutes != null ? formatDuration(m.durationMinutes) : "Open"), width: 12 },
      { header: "Status", value: (m) => statusLabel("movement", displayStatus(m, settings, today)), width: 14 },
      { header: "Approval", value: (m) => statusLabel("movementApproval", m.approvalStatus), width: 16 },
      { header: "Entry", value: (m) => (m.entryMode === "alternative" ? "Late entry" : "Live"), width: 10 },
      { header: "Approved / decided by", value: (m) => m.approvedByName ?? "", width: 18 },
    ],
  });
}
