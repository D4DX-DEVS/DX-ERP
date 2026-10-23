import { NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Project, Task, TimesheetEntry } from "@/lib/models";
import { exportResponse, isExportFormat } from "@/lib/export";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { inList } from "@/lib/sql";
import { isObjectId } from "@/lib/validation";
import { peopleMap, timesheetScope, type Filter } from "@/lib/work-access";

const MAX_ROWS = 20_000;

/**
 * Timesheet export (CSV / Excel / PDF) by employee, project and date range. Reviewers receive only
 * the entries inside their scope; `timesheets.view_all` / `timesheets.approve` holders receive everything.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const scope = await timesheetScope(user, "view");
  if (!scope.hasAccess) return NextResponse.json({ error: "You don't have permission to export timesheets." }, { status: 403 });

  const url = new URL(request.url);
  const formatParam = url.searchParams.get("format");
  const format = isExportFormat(formatParam) ? formatParam : "xlsx";
  const employee = url.searchParams.get("employee") ?? "";
  const project = url.searchParams.get("project") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  const conds: Filter[] = [scope.all ? undefined : scope.filter];
  if (isObjectId(employee)) conds.push(eq(TimesheetEntry.user, employee));
  if (isObjectId(project)) conds.push(eq(TimesheetEntry.project, project));
  if (dateOk(from)) conds.push(gte(TimesheetEntry.date, from));
  if (dateOk(to)) conds.push(lte(TimesheetEntry.date, to));
  const filter: Filter = and(...conds);

  const entries = await db()
    .select({
      user: TimesheetEntry.user,
      date: TimesheetEntry.date,
      weekStart: TimesheetEntry.weekStart,
      project: TimesheetEntry.project,
      task: TimesheetEntry.task,
      description: TimesheetEntry.description,
      billable: TimesheetEntry.billable,
      minutes: TimesheetEntry.minutes,
      status: TimesheetEntry.status,
      reviewerName: TimesheetEntry.reviewerName,
      reviewedAt: TimesheetEntry.reviewedAt,
    })
    .from(TimesheetEntry)
    .where(filter)
    .orderBy(asc(TimesheetEntry.date), asc(TimesheetEntry.user), asc(TimesheetEntry.createdAt))
    .limit(MAX_ROWS);
  const projectIds = [...new Set(entries.map((e) => e.project).filter(Boolean) as string[])];
  const taskIds = [...new Set(entries.map((e) => e.task).filter(Boolean) as string[])];
  const [people, projects, tasks] = await Promise.all([
    peopleMap(entries.map((e) => e.user)),
    projectIds.length ? db().select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title }).from(Project).where(inList(Project._id, projectIds)) : [],
    taskIds.length ? db().select({ _id: Task._id, taskNo: Task.taskNo, title: Task.title }).from(Task).where(inList(Task._id, taskIds)) : [],
  ]);
  const projectLabel = new Map(projects.map((p) => [p._id, `${p.projectNo} ${p.title}`]));
  const taskLabel = new Map(tasks.map((t) => [t._id, `${t.taskNo} ${t.title}`]));

  const subtitle = [
    isObjectId(employee) ? `Employee: ${people.get(employee)?.name ?? employee}` : "All employees",
    isObjectId(project) ? `Project: ${projectLabel.get(project) ?? project}` : "all projects",
    dateOk(from) || dateOk(to) ? `${dateOk(from) ? fmtDate(from) : "start"} to ${dateOk(to) ? fmtDate(to) : "today"}` : "all dates",
  ].join(" · ");

  await audit(user, { action: "export", entity: "timesheet", summary: `Exported ${entries.length} timesheet entries (${format})` });

  return exportResponse({
    title: "Timesheets",
    filename: "timesheets",
    format,
    subtitle,
    rows: entries,
    columns: [
      { header: "Employee", value: (e) => people.get(e.user)?.name ?? "Unknown", width: 24 },
      { header: "Date", value: (e) => e.date, width: 12 },
      { header: "Week starting", value: (e) => e.weekStart, width: 14 },
      { header: "Project", value: (e) => (e.project ? projectLabel.get(e.project) : "—"), width: 30 },
      { header: "Task", value: (e) => (e.task ? taskLabel.get(e.task) : "—"), width: 30 },
      { header: "Description", value: (e) => e.description, width: 40 },
      { header: "Billable", value: (e) => (e.billable ? "Yes" : "No"), width: 10 },
      { header: "Hours", value: (e) => Math.round((e.minutes / 60) * 100) / 100, type: "number", width: 8 },
      { header: "Status", value: (e) => e.status, width: 12 },
      { header: "Reviewer", value: (e) => e.reviewerName ?? "", width: 20 },
      { header: "Reviewed", value: (e) => (e.reviewedAt ? fmtDateTime(e.reviewedAt) : ""), width: 20 },
    ],
  });
}
