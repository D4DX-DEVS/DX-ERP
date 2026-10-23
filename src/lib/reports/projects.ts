import "server-only";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Issue, Project, Task, TimesheetEntry, User, ISSUE_STATUSES, type ITask } from "@/lib/models";
import type { Types } from "mongoose";
import { getSettings } from "@/lib/settings";
import { optionLabel, statusLabel } from "@/lib/status";
import { diffDays, fmtDate, todayKey } from "@/lib/time";
import { round2, titleCase } from "@/lib/format";
import {
  clientNames,
  DEPARTMENT_FILTER,
  hoursOf,
  instantRange,
  PERSON_FILTER,
  peopleMap,
  projectMap,
  rangeOf,
  RANGE_FILTERS,
  userScope,
  type PersonInfo,
} from "./shared";
import { defineReport } from "./types";

/**
 * Project reports need only `reports.view`; what they cover depends on the viewer's reach:
 * everything with the matching view-all permission, otherwise only projects they manage or belong
 * to (and, for tasks / issues / timesheets, their own plus their direct reports').
 */
async function memberProjectIds(user: CurrentUser): Promise<Types.ObjectId[]> {
  return Project.distinct("_id", { $or: [{ manager: user._id }, { "team.user": user._id }] });
}

/** `null` means unrestricted. */
async function projectReach(user: CurrentUser): Promise<Types.ObjectId[] | null> {
  return can(user, "projects.view_all") ? null : memberProjectIds(user);
}

const SCOPE_NOTE = "You see the projects you manage or belong to.";

/* ------------------------------------------------------------ project progress */

interface ProjectProgressRow {
  projectNo: string;
  title: string;
  client: string;
  manager: string;
  status: string;
  priority: string;
  startDate?: string;
  targetDate?: string;
  completedDate?: string;
  progress?: number;
  tasks: number;
  tasksDone: number;
  milestones: number;
  onTime: number;
  late: number;
  overdue: number;
  delayDays: number;
}

const projectProgress = defineReport<ProjectProgressRow>({
  key: "project-progress",
  title: "Project progress & delivery performance",
  group: "Projects",
  description: "Progress, schedule slippage and milestone delivery (on time vs late) for each project.",
  permissions: ["reports.view"],
  filters: [
    { key: "status", label: "Status", type: "select", optionsFrom: "projectStatuses" },
    { key: "client", label: "Client", type: "client" },
    { key: "project", label: "Project", type: "project" },
  ],
  async run(f, user) {
    await connectDB();
    const settings = await getSettings();
    const today = todayKey();
    const reach = await projectReach(user);
    const filter: Record<string, unknown> = {};
    if (f.status) filter.status = f.status;
    if (f.client) filter.client = f.client;
    if (reach) filter._id = f.project ? (reach.some((id) => id.toString() === f.project) ? f.project : { $in: [] }) : { $in: reach };
    else if (f.project) filter._id = f.project;
    const projects = await Project.find(filter, { projectNo: 1, title: 1, client: 1, manager: 1, status: 1, priority: 1, startDate: 1, targetDate: 1, completedDate: 1, milestones: 1 })
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    const ids = projects.map((p) => p._id);
    const doneKeys = settings.taskStatuses.filter((s) => s.category === "done").map((s) => s.key);
    const cancelledKeys = settings.taskStatuses.filter((s) => s.category === "cancelled").map((s) => s.key);
    const [taskStats, clients, people] = await Promise.all([
      Task.aggregate<{ _id: Types.ObjectId; total: number; done: number; progress: number }>([
        { $match: { project: { $in: ids }, status: { $nin: cancelledKeys } } },
        {
          $group: {
            _id: "$project",
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $in: ["$status", doneKeys] }, 1, 0] } },
            progress: { $avg: { $cond: [{ $in: ["$status", doneKeys] }, 100, "$progress"] } },
          },
        },
      ]),
      clientNames(projects.map((p) => p.client), user),
      peopleMap(projects.map((p) => p.manager)),
    ]);
    const stats = new Map(taskStats.map((s) => [s._id.toString(), s]));
    const closedCategories = new Set(["completed", "cancelled"]);

    const rows: ProjectProgressRow[] = projects.map((p) => {
      const category = settings.projectStatuses.find((s) => s.key === p.status)?.category;
      const s = stats.get(p._id.toString());
      let onTime = 0;
      let late = 0;
      let overdue = 0;
      for (const m of p.milestones) {
        const delivered = m.status === "delivered" || m.status === "approved" || Boolean(m.deliveredAt);
        if (delivered) {
          if (m.dueDate && m.deliveredAt && m.deliveredAt > m.dueDate) late += 1;
          else onTime += 1;
        } else if (m.dueDate && m.dueDate < today) overdue += 1;
      }
      const open = category ? !closedCategories.has(category) : !p.completedDate;
      const delayDays = p.targetDate
        ? open
          ? Math.max(0, diffDays(p.targetDate, today))
          : p.completedDate
            ? Math.max(0, diffDays(p.targetDate, p.completedDate))
            : 0
        : 0;
      return {
        projectNo: p.projectNo,
        title: p.title,
        client: p.client ? (clients.get(p.client.toString()) ?? "") : "Internal",
        manager: p.manager ? (people.get(p.manager.toString())?.name ?? "") : "",
        status: optionLabel(settings.projectStatuses, p.status),
        priority: statusLabel("priority", p.priority),
        startDate: p.startDate,
        targetDate: p.targetDate,
        completedDate: p.completedDate,
        progress: s ? Math.round(s.progress) : category === "completed" ? 100 : undefined,
        tasks: s?.total ?? 0,
        tasksDone: s?.done ?? 0,
        milestones: p.milestones.length,
        onTime,
        late,
        overdue,
        delayDays,
      };
    });
    const delivered = rows.reduce((t, r) => t + r.onTime + r.late, 0);
    return {
      columns: [
        { header: "Project", value: (r) => r.projectNo },
        { header: "Title", value: (r) => r.title, width: 32 },
        { header: "Client", value: (r) => r.client, width: 24 },
        { header: "Manager", value: (r) => r.manager, width: 22 },
        { header: "Status", value: (r) => r.status },
        { header: "Priority", value: (r) => r.priority },
        { header: "Start", value: (r) => fmtDate(r.startDate) },
        { header: "Target", value: (r) => fmtDate(r.targetDate) },
        { header: "Completed", value: (r) => fmtDate(r.completedDate) },
        { header: "Progress %", value: (r) => r.progress, type: "number" },
        { header: "Tasks", value: (r) => r.tasks, type: "number" },
        { header: "Tasks done", value: (r) => r.tasksDone, type: "number" },
        { header: "Milestones", value: (r) => r.milestones, type: "number" },
        { header: "Delivered on time", value: (r) => r.onTime, type: "number" },
        { header: "Delivered late", value: (r) => r.late, type: "number" },
        { header: "Overdue milestones", value: (r) => r.overdue, type: "number" },
        { header: "Days past target", value: (r) => r.delayDays, type: "number" },
      ],
      rows,
      summary: [
        { label: "Projects", value: String(rows.length) },
        { label: "Behind schedule", value: String(rows.filter((r) => r.delayDays > 0).length) },
        { label: "Milestones on time", value: delivered ? `${Math.round((rows.reduce((t, r) => t + r.onTime, 0) / delivered) * 100)}%` : "—" },
        { label: "Overdue milestones", value: String(rows.reduce((t, r) => t + r.overdue, 0)) },
      ],
      note: `Progress is the average task progress (done tasks count as 100%). Cancelled tasks are excluded.${reach ? ` ${SCOPE_NOTE}` : ""}`,
    };
  },
});

/* --------------------------------------------------------- task completion */

interface TaskRow {
  taskNo: string;
  title: string;
  project: string;
  assignees: string;
  priority: string;
  status: string;
  dueDate?: string;
  completedAt?: Date;
  timing: string;
  estimate: number;
  progress: number;
  overdue: boolean;
  done: boolean;
  onTime: boolean;
}

type TaskLean = Pick<ITask, "taskNo" | "title" | "project" | "assignees" | "priority" | "status" | "dueDate" | "completedAt" | "estimateHours" | "progress"> & { _id: Types.ObjectId };

const taskCompletion = defineReport<TaskRow>({
  key: "task-completion",
  title: "Task completion & overdue tasks",
  group: "Projects",
  description: "Tasks due or completed in the period, whether they finished on time, and what is overdue now.",
  permissions: ["reports.view"],
  filters: [
    ...RANGE_FILTERS,
    { key: "project", label: "Project", type: "project" },
    { ...PERSON_FILTER, label: "Assignee" },
    {
      key: "state",
      label: "Show",
      type: "select",
      options: [
        { value: "overdue", label: "Overdue (open)" },
        { value: "completed", label: "Completed" },
        { value: "open", label: "Open" },
      ],
    },
  ],
  async run(f, user) {
    await connectDB();
    const settings = await getSettings();
    const today = todayKey();
    const { from, to } = rangeOf(f);
    const { start, end } = instantRange(from, to);
    const scoped = !can(user, "tasks.view_all");
    const doneKeys = settings.taskStatuses.filter((s) => s.category === "done").map((s) => s.key);
    const closedKeys = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);
    const and: Record<string, unknown>[] = [{ $or: [{ dueDate: { $gte: from, $lte: to } }, { completedAt: { $gte: start, $lte: end } }] }];
    if (scoped) and.push({ $or: [{ assignees: user._id }, { reporter: user._id }, { reviewer: user._id }, { project: { $in: await memberProjectIds(user) } }] });
    if (f.project) and.push({ project: f.project });
    if (f.person) and.push({ assignees: f.person });
    if (f.state === "overdue") and.push({ status: { $nin: closedKeys }, dueDate: { $lt: today } });
    if (f.state === "completed") and.push({ status: { $in: doneKeys } });
    if (f.state === "open") and.push({ status: { $nin: closedKeys } });
    const tasks: TaskLean[] = await Task.find(
      { $and: and },
      { taskNo: 1, title: 1, project: 1, assignees: 1, priority: 1, status: 1, dueDate: 1, completedAt: 1, estimateHours: 1, progress: 1 },
    )
      .sort({ dueDate: 1 })
      .limit(20_000)
      .lean();
    const [projects, people] = await Promise.all([projectMap(tasks.map((t) => t.project)), peopleMap(tasks.flatMap((t) => t.assignees))]);
    const rows: TaskRow[] = tasks.map((t) => {
      const done = doneKeys.includes(t.status);
      const closed = closedKeys.includes(t.status);
      const completedDay = t.completedAt ? t.completedAt.toISOString().slice(0, 10) : undefined;
      let timing = "Open";
      let onTime = false;
      let overdue = false;
      if (done) {
        if (t.dueDate && completedDay && completedDay > t.dueDate) timing = `Late by ${diffDays(t.dueDate, completedDay)} d`;
        else {
          timing = "On time";
          onTime = true;
        }
      } else if (closed) timing = "Cancelled";
      else if (t.dueDate && t.dueDate < today) {
        timing = `Overdue by ${diffDays(t.dueDate, today)} d`;
        overdue = true;
      }
      const project = t.project ? projects.get(t.project.toString()) : undefined;
      return {
        taskNo: t.taskNo,
        title: t.title,
        project: project ? `${project.projectNo} · ${project.title}` : "No project",
        assignees: t.assignees.map((a) => people.get(a.toString())?.name ?? "").filter(Boolean).join(", "),
        priority: statusLabel("priority", t.priority),
        status: optionLabel(settings.taskStatuses, t.status),
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        timing,
        estimate: t.estimateHours,
        progress: t.progress,
        overdue,
        done,
        onTime,
      };
    });
    const done = rows.filter((r) => r.done);
    return {
      columns: [
        { header: "Task", value: (r) => r.taskNo },
        { header: "Title", value: (r) => r.title, width: 36 },
        { header: "Project", value: (r) => r.project, width: 30 },
        { header: "Assignees", value: (r) => r.assignees, width: 26 },
        { header: "Priority", value: (r) => r.priority },
        { header: "Status", value: (r) => r.status },
        { header: "Due", value: (r) => fmtDate(r.dueDate) },
        { header: "Completed on", value: (r) => fmtDate(r.completedAt) },
        { header: "Timing", value: (r) => r.timing },
        { header: "Estimate (h)", value: (r) => r.estimate, type: "number" },
        { header: "Progress %", value: (r) => r.progress, type: "number" },
      ],
      rows,
      summary: [
        { label: "Tasks", value: String(rows.length) },
        { label: "Completed", value: String(done.length) },
        { label: "Completed on time", value: done.length ? `${Math.round((done.filter((r) => r.onTime).length / done.length) * 100)}%` : "—" },
        { label: "Overdue now", value: String(rows.filter((r) => r.overdue).length) },
      ],
      note: `Includes tasks whose due date or completion date falls in the period.${scoped ? " You see tasks assigned to you and tasks in projects you manage or belong to." : ""}`,
    };
  },
});

/* -------------------------------------------------------- workload & timesheets */

interface WorkloadRow {
  person: PersonInfo;
  project: string;
  entries: number;
  hours: number;
  billable: number;
  approved: number;
  submitted: number;
  other: number;
}

const workloadTimesheets = defineReport<WorkloadRow>({
  key: "workload-timesheets",
  title: "Employee workload & timesheets",
  group: "Projects",
  description: "Hours logged per person per project with billable share and timesheet approval status.",
  permissions: ["reports.view"],
  filters: [...RANGE_FILTERS, DEPARTMENT_FILTER, PERSON_FILTER, { key: "project", label: "Project", type: "project" }],
  async run(f, user) {
    await connectDB();
    const { from, to } = rangeOf(f);
    const scoped = !can(user, "timesheets.view_all");
    const team = scoped ? [user._id, ...(await User.distinct("_id", { reportingManager: user._id }))] : [];
    const filter: Record<string, unknown> = { date: { $gte: from, $lte: to }, $and: [await userScope(f), ...(scoped ? [{ user: { $in: team } }] : [])] };
    if (f.project) filter.project = f.project;
    const entries = await TimesheetEntry.find(filter, { user: 1, project: 1, minutes: 1, billable: 1, status: 1 }).limit(100_000).lean();
    const [people, projects] = await Promise.all([peopleMap(entries.map((e) => e.user)), projectMap(entries.map((e) => e.project))]);
    const map = new Map<string, WorkloadRow & { minutes: number; billableMin: number; approvedMin: number; submittedMin: number }>();
    for (const e of entries) {
      const person = people.get(e.user.toString());
      if (!person) continue;
      const key = `${person.id}|${e.project?.toString() ?? ""}`;
      const project = e.project ? projects.get(e.project.toString()) : undefined;
      const row = map.get(key) ?? {
        person,
        project: project ? `${project.projectNo} · ${project.title}` : "No project",
        entries: 0,
        hours: 0,
        billable: 0,
        approved: 0,
        submitted: 0,
        other: 0,
        minutes: 0,
        billableMin: 0,
        approvedMin: 0,
        submittedMin: 0,
      };
      row.entries += 1;
      row.minutes += e.minutes;
      if (e.billable) row.billableMin += e.minutes;
      if (e.status === "approved") row.approvedMin += e.minutes;
      if (e.status === "submitted") row.submittedMin += e.minutes;
      map.set(key, row);
    }
    const rows: WorkloadRow[] = [...map.values()]
      .map((r) => ({
        person: r.person,
        project: r.project,
        entries: r.entries,
        hours: hoursOf(r.minutes),
        billable: hoursOf(r.billableMin),
        approved: hoursOf(r.approvedMin),
        submitted: hoursOf(r.submittedMin),
        other: hoursOf(r.minutes - r.approvedMin - r.submittedMin),
      }))
      .sort((a, b) => a.person.name.localeCompare(b.person.name) || b.hours - a.hours);
    const total = rows.reduce((s, r) => s + r.hours, 0);
    return {
      columns: [
        { header: "Employee ID", value: (r) => r.person.employeeId },
        { header: "Employee", value: (r) => r.person.name, width: 24 },
        { header: "Department", value: (r) => r.person.department, width: 20 },
        { header: "Project", value: (r) => r.project, width: 34 },
        { header: "Entries", value: (r) => r.entries, type: "number" },
        { header: "Hours", value: (r) => r.hours, type: "number" },
        { header: "Billable hours", value: (r) => r.billable, type: "number" },
        { header: "Approved hours", value: (r) => r.approved, type: "number" },
        { header: "Awaiting approval (h)", value: (r) => r.submitted, type: "number" },
        { header: "Draft / rejected (h)", value: (r) => r.other, type: "number" },
      ],
      rows,
      summary: [
        { label: "People", value: String(new Set(rows.map((r) => r.person.id)).size) },
        { label: "Hours logged", value: String(round2(total)) },
        { label: "Billable share", value: total ? `${Math.round((rows.reduce((s, r) => s + r.billable, 0) / total) * 100)}%` : "—" },
        { label: "Awaiting approval", value: `${round2(rows.reduce((s, r) => s + r.submitted, 0))} h` },
      ],
      note: scoped ? "You see your own time and your direct reports' time." : undefined,
    };
  },
});

/* ---------------------------------------------------------------- QA issues */

interface IssueRow {
  issueNo: string;
  project: string;
  title: string;
  severity: string;
  priority: string;
  status: string;
  assignee: string;
  reporter: string;
  reportedDate: string;
  targetDate?: string;
  resolvedAt?: Date;
  resolutionDays?: number;
  reopened: number;
  unresolved: boolean;
  critical: boolean;
}

const qaIssues = defineReport<IssueRow>({
  key: "qa-issues",
  title: "QA issues & resolution status",
  group: "Projects",
  description: "Issues reported in the period with severity, status, time to resolve and reopen counts.",
  permissions: ["reports.view"],
  filters: [
    ...RANGE_FILTERS,
    { key: "project", label: "Project", type: "project" },
    { key: "status", label: "Status", type: "select", options: ISSUE_STATUSES.map((s) => ({ value: s, label: statusLabel("issue", s) })) },
    { key: "severity", label: "Severity", type: "select", options: ["critical", "major", "minor", "trivial"].map((s) => ({ value: s, label: statusLabel("severity", s) })) },
    { ...PERSON_FILTER, label: "Assignee" },
  ],
  async run(f, user) {
    await connectDB();
    const { from, to } = rangeOf(f);
    const scoped = !can(user, "qa.view_all");
    const filter: Record<string, unknown> = { reportedDate: { $gte: from, $lte: to } };
    if (scoped) filter.$or = [{ assignee: user._id }, { reporter: user._id }, { project: { $in: await memberProjectIds(user) } }];
    if (f.project) filter.project = f.project;
    if (f.status) filter.status = f.status;
    if (f.severity) filter.severity = f.severity;
    if (f.person) filter.assignee = f.person;
    const issues = await Issue.find(filter, {
      issueNo: 1,
      project: 1,
      title: 1,
      severity: 1,
      priority: 1,
      status: 1,
      assignee: 1,
      reporter: 1,
      reportedDate: 1,
      targetDate: 1,
      resolvedAt: 1,
      createdAt: 1,
      reopenCount: 1,
    })
      .sort({ reportedDate: -1 })
      .limit(20_000)
      .lean();
    const [projects, people] = await Promise.all([projectMap(issues.map((i) => i.project)), peopleMap([...issues.map((i) => i.assignee), ...issues.map((i) => i.reporter)])]);
    const resolvedStatuses = new Set(["fixed", "ready_for_testing", "verified", "closed"]);
    const rows: IssueRow[] = issues.map((i) => {
      const project = projects.get(i.project.toString());
      return {
        issueNo: i.issueNo,
        project: project ? `${project.projectNo} · ${project.title}` : "",
        title: i.title,
        severity: statusLabel("severity", i.severity),
        priority: statusLabel("priority", i.priority),
        status: statusLabel("issue", i.status),
        assignee: i.assignee ? (people.get(i.assignee.toString())?.name ?? "") : "",
        reporter: people.get(i.reporter.toString())?.name ?? "",
        reportedDate: i.reportedDate,
        targetDate: i.targetDate,
        resolvedAt: i.resolvedAt,
        resolutionDays: i.resolvedAt ? round2((i.resolvedAt.getTime() - i.createdAt.getTime()) / 86_400_000) : undefined,
        reopened: i.reopenCount,
        unresolved: !resolvedStatuses.has(i.status),
        critical: i.severity === "critical",
      };
    });
    const resolved = rows.filter((r) => r.resolutionDays !== undefined);
    return {
      columns: [
        { header: "Issue", value: (r) => r.issueNo },
        { header: "Project", value: (r) => r.project, width: 30 },
        { header: "Title", value: (r) => r.title, width: 38 },
        { header: "Severity", value: (r) => r.severity },
        { header: "Priority", value: (r) => r.priority },
        { header: "Status", value: (r) => r.status },
        { header: "Assignee", value: (r) => r.assignee, width: 22 },
        { header: "Reporter", value: (r) => r.reporter, width: 22 },
        { header: "Reported", value: (r) => fmtDate(r.reportedDate) },
        { header: "Target", value: (r) => fmtDate(r.targetDate) },
        { header: "Resolved on", value: (r) => fmtDate(r.resolvedAt) },
        { header: "Days to resolve", value: (r) => r.resolutionDays, type: "number" },
        { header: "Reopened", value: (r) => r.reopened, type: "number" },
      ],
      rows,
      summary: [
        { label: "Issues", value: String(rows.length) },
        { label: "Unresolved", value: String(rows.filter((r) => r.unresolved).length) },
        { label: "Critical unresolved", value: String(rows.filter((r) => r.unresolved && r.critical).length) },
        { label: "Avg days to resolve", value: resolved.length ? String(round2(resolved.reduce((s, r) => s + (r.resolutionDays ?? 0), 0) / resolved.length)) : "—" },
      ],
    };
  },
});

/* ------------------------------------------------- estimated vs actual effort */

interface EffortRow {
  ref: string;
  title: string;
  project: string;
  status: string;
  estimate: number;
  taskEstimate?: number;
  logged: number;
}

const effort = defineReport<EffortRow>({
  key: "effort-estimate-actual",
  title: "Estimated vs actual effort",
  group: "Projects",
  description: "Estimated hours against hours logged in timesheets, per project or per task.",
  permissions: ["reports.view"],
  filters: [
    {
      key: "level",
      label: "Level",
      type: "select",
      options: [
        { value: "project", label: "Per project" },
        { value: "task", label: "Per task" },
      ],
      defaultValue: () => "project",
    },
    { key: "project", label: "Project", type: "project" },
    { key: "status", label: "Project status", type: "select", optionsFrom: "projectStatuses" },
  ],
  async run(f, user) {
    await connectDB();
    const settings = await getSettings();
    const taskLevel = f.level === "task";
    const reach = await projectReach(user);
    const projectFilter: Record<string, unknown> = {};
    if (reach) projectFilter._id = f.project ? (reach.some((id) => id.toString() === f.project) ? f.project : { $in: [] }) : { $in: reach };
    else if (f.project) projectFilter._id = f.project;
    if (f.status) projectFilter.status = f.status;
    const projects = await Project.find(projectFilter, { projectNo: 1, title: 1, status: 1, estimatedHours: 1 }).sort({ createdAt: -1 }).limit(2000).lean();
    const projectIds = projects.map((p) => p._id);
    const projectById = new Map(projects.map((p) => [p._id.toString(), p]));
    const entryMatch = { project: { $in: projectIds }, status: { $ne: "rejected" } };
    let rows: EffortRow[];

    if (!taskLevel) {
      const [logged, taskSums] = await Promise.all([
        TimesheetEntry.aggregate<{ _id: Types.ObjectId; minutes: number }>([{ $match: entryMatch }, { $group: { _id: "$project", minutes: { $sum: "$minutes" } } }]),
        Task.aggregate<{ _id: Types.ObjectId; hours: number }>([{ $match: { project: { $in: projectIds } } }, { $group: { _id: "$project", hours: { $sum: "$estimateHours" } } }]),
      ]);
      const loggedBy = new Map(logged.map((l) => [l._id.toString(), l.minutes]));
      const taskBy = new Map(taskSums.map((t) => [t._id.toString(), t.hours]));
      rows = projects.map((p) => ({
        ref: p.projectNo,
        title: p.title,
        project: "",
        status: optionLabel(settings.projectStatuses, p.status),
        estimate: p.estimatedHours,
        taskEstimate: taskBy.get(p._id.toString()) ?? 0,
        logged: hoursOf(loggedBy.get(p._id.toString()) ?? 0),
      }));
    } else {
      const [tasks, logged] = await Promise.all([
        Task.find({ project: { $in: projectIds } }, { taskNo: 1, title: 1, project: 1, status: 1, estimateHours: 1 }).sort({ createdAt: -1 }).limit(20_000).lean(),
        TimesheetEntry.aggregate<{ _id: Types.ObjectId; minutes: number }>([{ $match: { ...entryMatch, task: { $exists: true, $ne: null } } }, { $group: { _id: "$task", minutes: { $sum: "$minutes" } } }]),
      ]);
      const loggedBy = new Map(logged.map((l) => [l._id.toString(), l.minutes]));
      rows = tasks.map((t) => {
        const p = t.project ? projectById.get(t.project.toString()) : undefined;
        return {
          ref: t.taskNo,
          title: t.title,
          project: p ? `${p.projectNo} · ${p.title}` : "",
          status: optionLabel(settings.taskStatuses, t.status),
          estimate: t.estimateHours,
          logged: hoursOf(loggedBy.get(t._id.toString()) ?? 0),
        };
      });
    }
    const estimate = rows.reduce((s, r) => s + r.estimate, 0);
    const logged = rows.reduce((s, r) => s + r.logged, 0);
    return {
      columns: [
        { header: taskLevel ? "Task" : "Project", value: (r) => r.ref },
        { header: "Title", value: (r) => r.title, width: 36 },
        ...(taskLevel ? [{ header: "Project", value: (r: EffortRow) => r.project, width: 30 }] : []),
        { header: "Status", value: (r) => r.status },
        { header: taskLevel ? "Estimate (h)" : "Project estimate (h)", value: (r) => r.estimate, type: "number" },
        ...(taskLevel ? [] : [{ header: "Sum of task estimates (h)", value: (r: EffortRow) => r.taskEstimate, type: "number" as const }]),
        { header: "Logged (h)", value: (r) => r.logged, type: "number" },
        { header: "Variance (h)", value: (r) => round2(r.logged - r.estimate), type: "number" },
        { header: "% of estimate used", value: (r) => (r.estimate > 0 ? Math.round((r.logged / r.estimate) * 100) : null), type: "number" },
      ],
      rows,
      summary: [
        { label: taskLevel ? "Tasks" : "Projects", value: String(rows.length) },
        { label: "Estimated", value: `${round2(estimate)} h` },
        { label: "Logged", value: `${round2(logged)} h` },
        { label: "Over estimate", value: String(rows.filter((r) => r.estimate > 0 && r.logged > r.estimate).length) },
      ],
      note: `Logged hours include all timesheet entries except rejected ones. ${titleCase(taskLevel ? "task" : "project")}-level view.${reach ? ` ${SCOPE_NOTE}` : ""}`,
    };
  },
});

export const projectReports = [projectProgress, taskCompletion, workloadTimesheets, qaIssues, effort];
