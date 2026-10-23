import "server-only";
import { connectDB } from "@/lib/db";
import { Project, Task, User, Types, type HistoryEntry, type IssueStatus, type ObjectId } from "@/lib/models";
import { can, isInternLike, type CurrentUser } from "@/lib/auth/session";
import type { StatusOption } from "@/lib/config-defaults";

/**
 * Visibility and capability rules for the Work modules (projects, tasks, timesheets, QA).
 * Every page and action derives what a user may see or do from here so the rules live in one
 * place (FRS §6.3, §11.4, §13.3). Interns and trainees only ever see tasks assigned or shared
 * with them and issues assigned to / reported by them, and never receive client or budget data.
 */
export type Filter = Record<string, unknown>;
type Id = { toString(): string };

const sid = (v: Id | null | undefined): string | undefined => v?.toString();

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

export function historyEntry(
  user: Pick<CurrentUser, "_id" | "name">,
  action: string,
  extra: { note?: string; from?: string; to?: string } = {},
): HistoryEntry {
  return { action, by: user._id, byName: user.name, at: new Date(), ...extra };
}

export interface PersonLite {
  id: string;
  name: string;
  photo?: string;
  personType: string;
}

/** id → { name, photo, personType } for a set of users. */
export async function peopleMap(ids: (Id | null | undefined)[]): Promise<Map<string, PersonLite>> {
  const unique = [...new Set(ids.filter(Boolean).map((x) => x!.toString()))];
  if (unique.length === 0) return new Map();
  await connectDB();
  const users = await User.find({ _id: { $in: unique } }, { name: 1, photo: 1, personType: 1 }).lean();
  return new Map(users.map((u) => [u._id.toString(), { id: u._id.toString(), name: u.name, photo: u.photo, personType: u.personType }]));
}

export function keysInCategories(options: StatusOption[], categories: string[]): string[] {
  return options.filter((o) => categories.includes(o.category)).map((o) => o.key);
}

export function firstInCategory(options: StatusOption[], category: string): string | undefined {
  return options.find((o) => o.category === category)?.key;
}

export function categoryOf(options: StatusOption[], key: string | null | undefined): string | undefined {
  return key ? options.find((o) => o.key === key)?.category : undefined;
}

/** Task statuses that no longer count as open work. */
export const TASK_CLOSED_CATEGORIES = ["done", "cancelled"];
/** Project statuses that no longer count as running. */
export const PROJECT_CLOSED_CATEGORIES = ["completed", "cancelled"];
/** Issues that are still unresolved (not yet verified or closed). */
export const ISSUE_RESOLVED_STATUSES = ["verified", "closed"];

export function toObjectIds(ids: string[]): ObjectId[] {
  return ids.map((id) => new Types.ObjectId(id));
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

/** Mongo filter for the projects a user may see. */
export function projectFilter(user: CurrentUser): Filter {
  if (can(user, "projects.view_all")) return {};
  return { $or: [{ manager: user._id }, { "team.user": user._id }] };
}

export interface ProjectCaps {
  isManager: boolean;
  isMember: boolean;
  view: boolean;
  /** Edit the project, milestones and team: `projects.manage` or the project manager. */
  manage: boolean;
  /** Budget, billing and cost data. Never granted to interns / trainees. */
  financials: boolean;
  /** Interns and trainees: no client, budget or organisation-wide data. */
  restricted: boolean;
}

export function projectCaps(user: CurrentUser, project: { manager?: Id | null; team?: { user: Id }[] }): ProjectCaps {
  const isManager = sid(project.manager) === user.id;
  const isMember = (project.team ?? []).some((m) => m.user.toString() === user.id);
  const restricted = isInternLike(user);
  return {
    isManager,
    isMember,
    view: can(user, "projects.view_all") || isManager || isMember,
    manage: can(user, "projects.manage") || isManager,
    financials: can(user, "projects.financials") && !restricted,
    restricted,
  };
}

/** Restricted clients (FRS §14) are hidden from people without `crm.confidential`; interns never see clients. */
export function canSeeClient(user: CurrentUser, client: { confidential?: boolean; owner?: Id | null }): boolean {
  if (isInternLike(user)) return false;
  if (!client.confidential) return true;
  return can(user, "crm.confidential") || sid(client.owner) === user.id;
}

/** Ids of the projects a user manages or belongs to. */
export async function myProjectIds(user: CurrentUser): Promise<ObjectId[]> {
  await connectDB();
  const rows = await Project.find({ $or: [{ manager: user._id }, { "team.user": user._id }] }, { _id: 1 }).lean();
  return rows.map((r) => r._id);
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

/** Mongo filter for the tasks a user may see (FRS §11.4). */
export async function taskFilter(user: CurrentUser): Promise<Filter> {
  if (can(user, "tasks.view_all")) return {};
  const me = user._id;
  if (isInternLike(user)) return { $or: [{ assignees: me }, { sharedWith: me }] };
  await connectDB();
  const [projectIds, people] = await Promise.all([
    myProjectIds(user),
    User.find({ $or: [{ reportingManager: me }, { "internship.mentor": me }] }, { _id: 1 }).lean(),
  ]);
  const or: Filter[] = [{ assignees: me }, { sharedWith: me }, { reporter: me }, { reviewer: me }];
  if (projectIds.length) or.push({ project: { $in: projectIds } });
  // Managers and mentors can follow the work of their direct reports and mentees.
  if (people.length) or.push({ assignees: { $in: people.map((p) => p._id) } });
  // `tasks.review` holders can open work awaiting review (and work they reviewed) even when no reviewer was named.
  if (can(user, "tasks.review")) or.push({ "submissions.reviewStatus": "pending" }, { "submissions.reviewedBy": me });
  return { $or: or };
}

export interface TaskCaps {
  isAssignee: boolean;
  isReviewer: boolean;
  isReporter: boolean;
  isProjectManager: boolean;
  intern: boolean;
  /** Edit, reassign and set any status: `tasks.manage` or the project's manager. */
  manage: boolean;
  /** Approve or request changes on submitted work. */
  review: boolean;
  /** Add attachments. */
  attach: boolean;
}

export function taskCaps(
  user: CurrentUser,
  task: { assignees: Id[]; reporter?: Id | null; reviewer?: Id | null },
  projectManager?: Id | null,
): TaskCaps {
  const isAssignee = task.assignees.some((a) => a.toString() === user.id);
  const isReviewer = sid(task.reviewer) === user.id;
  const isReporter = sid(task.reporter) === user.id;
  const isProjectManager = Boolean(projectManager) && sid(projectManager) === user.id;
  const manage = can(user, "tasks.manage") || isProjectManager;
  return {
    isAssignee,
    isReviewer,
    isReporter,
    isProjectManager,
    intern: isInternLike(user),
    manage,
    review: isReviewer || can(user, "tasks.review") || isProjectManager,
    attach: manage || isAssignee || isReporter,
  };
}

/** Status keys the user may set directly on a task (the review flow covers approve / changes). */
export function allowedTaskStatuses(settings: { taskStatuses: StatusOption[] }, caps: TaskCaps, task: { status: string; reviewer?: Id | null }): string[] {
  const all = settings.taskStatuses;
  if (caps.manage) return all.map((s) => s.key);
  if (!caps.isAssignee) return [];
  const current = categoryOf(all, task.status);
  if (current === "done" || current === "cancelled") return [];
  const cats = new Set<string>(["open", "active", "blocked"]);
  // Interns / trainees must always submit work for review; others may move to review themselves,
  // and mark done only when nobody has to approve it.
  if (!caps.intern) {
    cats.add("review");
    if (!task.reviewer) cats.add("done");
  }
  return all.filter((s) => cats.has(s.category)).map((s) => s.key);
}

/** True when the user may create tasks in this project (or any task, with `tasks.manage`). */
export function canCreateTask(user: CurrentUser, project?: { manager?: Id | null } | null): boolean {
  if (can(user, "tasks.manage")) return true;
  return Boolean(project) && sid(project!.manager) === user.id;
}

/* ------------------------------------------------------------------ */
/* QA issues                                                           */
/* ------------------------------------------------------------------ */

/** Mongo filter for the issues a user may see (FRS §13.3). */
export async function issueFilter(user: CurrentUser): Promise<Filter> {
  if (can(user, "qa.view_all")) return {};
  const me = user._id;
  if (isInternLike(user)) return { $or: [{ assignee: me }, { reporter: me }] };
  const projectIds = await myProjectIds(user);
  const or: Filter[] = [{ assignee: me }, { reporter: me }];
  if (projectIds.length) or.push({ project: { $in: projectIds } });
  return { $or: or };
}

export interface IssueCaps {
  isAssignee: boolean;
  isReporter: boolean;
  isProjectManager: boolean;
  /** Create, assign and triage: `qa.manage` or the project manager. */
  manage: boolean;
  verify: boolean;
}

export function issueCaps(user: CurrentUser, issue: { assignee?: Id | null; reporter: Id }, projectManager?: Id | null): IssueCaps {
  const isProjectManager = Boolean(projectManager) && sid(projectManager) === user.id;
  return {
    isAssignee: sid(issue.assignee) === user.id,
    isReporter: issue.reporter.toString() === user.id,
    isProjectManager,
    manage: can(user, "qa.manage") || isProjectManager,
    verify: can(user, "qa.verify"),
  };
}

export type IssueStep = "start" | "fix" | "ready" | "verify" | "close" | "reopen";

/** QA workflow: open → assigned → in progress → fixed → ready for testing → verified → closed (reopen from fixed onwards). */
export const ISSUE_FLOW: Record<IssueStep, { from: IssueStatus[]; to: IssueStatus; label: string }> = {
  start: { from: ["assigned", "reopened"], to: "in_progress", label: "Work started" },
  fix: { from: ["in_progress"], to: "fixed", label: "Marked fixed" },
  ready: { from: ["fixed"], to: "ready_for_testing", label: "Ready for testing" },
  verify: { from: ["ready_for_testing"], to: "verified", label: "Fix verified" },
  close: { from: ["verified"], to: "closed", label: "Issue closed" },
  reopen: { from: ["fixed", "ready_for_testing", "verified", "closed"], to: "reopened", label: "Issue reopened" },
};

/** Workflow steps the user may take now: developers move their own issues, QA verifies, reporters / QA reopen. */
export function allowedIssueSteps(user: CurrentUser, caps: IssueCaps, issue: { status: IssueStatus; assignee?: Id | null }): IssueStep[] {
  const qaManage = can(user, "qa.manage");
  const permitted: Record<IssueStep, boolean> = {
    start: caps.isAssignee || qaManage,
    fix: caps.isAssignee || qaManage,
    ready: caps.isAssignee || qaManage || caps.verify,
    verify: caps.verify && !caps.isAssignee,
    close: caps.verify && !caps.isAssignee,
    reopen: caps.verify || caps.isReporter,
  };
  return (Object.keys(ISSUE_FLOW) as IssueStep[]).filter((step) => {
    if (!ISSUE_FLOW[step].from.includes(issue.status) || !permitted[step]) return false;
    if ((step === "start" || step === "fix") && !issue.assignee) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Timesheets                                                          */
/* ------------------------------------------------------------------ */

/** Projects the user may log time on: their projects plus those of tasks assigned / shared with them. */
export async function loggableProjectIds(user: CurrentUser): Promise<ObjectId[]> {
  await connectDB();
  const [mine, viaTasks] = await Promise.all([
    myProjectIds(user),
    Task.distinct("project", { $or: [{ assignees: user._id }, { sharedWith: user._id }], project: { $exists: true, $ne: null } }),
  ]);
  const seen = new Map<string, ObjectId>();
  for (const id of [...mine, ...(viaTasks as ObjectId[])]) seen.set(id.toString(), id);
  return [...seen.values()];
}

export interface TimesheetScope {
  /** Organisation-wide scope (`timesheets.approve`, or `timesheets.view_all` in view mode). */
  all: boolean;
  managedProjects: Set<string>;
  reports: Set<string>;
  /** Whether the user has any review responsibility at all. */
  hasAccess: boolean;
  /** Mongo filter matching the entries in scope (excludes the user's own entries). */
  filter: Filter;
  /** True when the entry falls inside the scope (never the user's own entry). */
  includes: (entry: { user: Id; project?: Id | null; reviewer?: Id | null }) => boolean;
}

/**
 * Who may review which timesheet entries: `timesheets.approve` holders review everything; project
 * managers review entries on their projects; reporting managers review their direct reports.
 */
export async function timesheetScope(user: CurrentUser, mode: "approve" | "view" = "approve"): Promise<TimesheetScope> {
  await connectDB();
  const all = can(user, "timesheets.approve") || (mode === "view" && can(user, "timesheets.view_all"));
  const [projects, reports] = await Promise.all([
    Project.find({ manager: user._id }, { _id: 1 }).lean(),
    User.find({ reportingManager: user._id }, { _id: 1 }).lean(),
  ]);
  const managedProjects = new Set(projects.map((p) => p._id.toString()));
  const reportSet = new Set(reports.map((r) => r._id.toString()));
  const or: Filter[] = [{ reviewer: user._id }];
  if (projects.length) or.push({ project: { $in: projects.map((p) => p._id) } });
  if (reports.length) or.push({ user: { $in: reports.map((r) => r._id) } });
  const filter: Filter = all ? { user: { $ne: user._id } } : { $and: [{ user: { $ne: user._id } }, { $or: or }] };
  const hasAccess = all || managedProjects.size > 0 || reportSet.size > 0;
  return {
    all,
    managedProjects,
    reports: reportSet,
    hasAccess,
    filter,
    includes: (entry) => {
      if (entry.user.toString() === user.id) return false;
      if (all) return true;
      if (sid(entry.reviewer) === user.id) return true;
      if (entry.project && managedProjects.has(entry.project.toString())) return true;
      return reportSet.has(entry.user.toString());
    },
  };
}
