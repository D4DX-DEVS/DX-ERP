import { NextResponse } from "next/server";
import type { Types } from "mongoose";
import { can, getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Department, Movement, Project, User, type IMovement } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { directReportIds } from "@/lib/people";
import { displayStatus, movementScope, scopeFilter } from "@/lib/movement/access";
import { exportResponse, isExportFormat } from "@/lib/export";
import { audit } from "@/lib/audit";
import { escapeRegex } from "@/lib/format";
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

  await connectDB();
  const settings = await getSettings();
  const today = todayKey();
  const valid = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = valid(sp.get("from")) ?? today;
  const to = valid(sp.get("to")) ?? from;
  const filter: Record<string, unknown> = { ...scopeFilter(user, scope), date: { $gte: from <= to ? from : to, $lte: from <= to ? to : from } };

  const department = sp.get("department");
  const q = sp.get("q")?.trim().slice(0, 100);
  if ((department && isObjectId(department)) || q) {
    const pf: Record<string, unknown> = {};
    if (department && isObjectId(department)) pf.department = department;
    if (q) pf.$or = [{ name: new RegExp(escapeRegex(q), "i") }, { employeeId: new RegExp(escapeRegex(q), "i") }];
    const ids = (await User.find(pf, { _id: 1 }).lean()).map((u) => u._id.toString());
    filter.user = { $in: scope.kind === "team" ? ids.filter((id) => scope.userIds.includes(id)) : ids };
  }
  const category = sp.get("category");
  if (category) filter.category = category;
  const approval = sp.get("approval");
  if (approval) filter.approvalStatus = approval;
  const status = sp.get("status");
  if (status === "returned" || status === "cancelled" || status === "out") filter.status = status;
  if (status === "overdue") Object.assign(filter, { status: "out", expectedReturn: { $lt: new Date(Date.now() - settings.movement.overdueGraceMinutes * 60_000) } });
  if (status === "missing_in") Object.assign(filter, { status: "out", date: { $lt: today, $gte: from } });

  const rows = await Movement.find(filter).sort({ date: 1, outTime: 1 }).limit(20_000).lean<(IMovement & { _id: Types.ObjectId })[]>();
  const [people, departments, projects, clients, reports] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => r.user.toString()))] } }, { name: 1, employeeId: 1, department: 1 }).lean(),
    Department.find({}, { name: 1 }).lean(),
    Project.find({ _id: { $in: rows.map((r) => r.project).filter((x): x is Types.ObjectId => Boolean(x)) } }, { projectNo: 1 }).lean(),
    Client.find({ _id: { $in: rows.map((r) => r.client).filter((x): x is Types.ObjectId => Boolean(x)) } }, { clientNo: 1 }).lean(),
    directReportIds(user._id),
  ]);
  const person = new Map(people.map((p) => [p._id.toString(), p]));
  const dept = new Map(departments.map((d) => [d._id.toString(), d.name]));
  const proj = new Map(projects.map((p) => [p._id.toString(), p.projectNo]));
  const cli = new Map(clients.map((c) => [c._id.toString(), c.clientNo]));
  const reportSet = new Set(reports);
  const showPersonal = (m: IMovement) => m.official || m.user.toString() === user.id || reportSet.has(m.user.toString()) || can(user, "movement.view_personal");

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
      { header: "Employee ID", value: (m) => person.get(m.user.toString())?.employeeId, width: 12 },
      { header: "Name", value: (m) => person.get(m.user.toString())?.name, width: 22 },
      { header: "Department", value: (m) => { const d = person.get(m.user.toString())?.department; return d ? dept.get(d.toString()) : ""; }, width: 18 },
      { header: "Category", value: (m) => (showPersonal(m) ? m.categoryLabel : "Personal"), width: 18 },
      { header: "Type", value: (m) => (m.official ? "Official" : "Personal"), width: 10 },
      { header: "Purpose", value: (m) => (showPersonal(m) ? m.purpose : "Personal"), width: 30 },
      { header: "Destination", value: (m) => (showPersonal(m) ? m.destination : ""), width: 24 },
      { header: "Reference", value: (m) => (m.project && proj.get(m.project.toString())) || (m.client && cli.get(m.client.toString())) || "", width: 12 },
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
