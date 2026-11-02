import "server-only";
import { count, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Project, Task, type ITask } from "@/lib/models";
import { inList } from "@/lib/sql";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { allowedTaskStatuses, categoryOf, keysInCategories, peopleMap, taskCaps, TASK_CLOSED_CATEGORIES } from "@/lib/work-access";
import { diffDays, todayKey } from "@/lib/time";

/** Plain view-model for task lists and boards (safe to hand to Client Components). */
export interface TaskRow {
  id: string;
  taskNo: string;
  title: string;
  status: string;
  priority: ITask["priority"];
  dueDate?: string;
  /** Days past due (>0) while the task is still open. */
  daysLate: number;
  projectId?: string;
  projectNo?: string;
  projectTitle?: string;
  assignees: { name: string; photo?: string; intern: boolean }[];
  estimateHours: number;
  progress: number;
  isLearning: boolean;
  /** A dependency is not finished, or the task is in a blocked status. */
  blocked: boolean;
  blockerNote?: string;
  subtasks: { done: number; total: number };
  /** Status keys the viewer may set from the status menu (empty = read-only). */
  allowedStatuses: string[];
}

export type TaskLean = Pick<
  ITask,
  "_id" | "taskNo" | "title" | "status" | "priority" | "dueDate" | "project" | "assignees" | "estimateHours" | "progress" | "isLearning" | "dependencies" | "blocker" | "reviewer" | "reporter"
>;

/** Columns selected for task list / board rows (the big JSON columns — comments, history, … — are left out). */
export const TASK_ROW_FIELDS = {
  _id: Task._id,
  taskNo: Task.taskNo,
  title: Task.title,
  status: Task.status,
  priority: Task.priority,
  dueDate: Task.dueDate,
  project: Task.project,
  assignees: Task.assignees,
  estimateHours: Task.estimateHours,
  progress: Task.progress,
  isLearning: Task.isLearning,
  dependencies: Task.dependencies,
  blocker: Task.blocker,
  reviewer: Task.reviewer,
  reporter: Task.reporter,
};

/** Builds list/board rows for lean tasks: project labels, assignee names, blocked flag, subtask counts and allowed status changes. */
export async function toTaskRows(user: CurrentUser, tasks: TaskLean[], settings: AppSettings): Promise<TaskRow[]> {
  if (tasks.length === 0) return [];
  const closedKeys = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const doneKeys = keysInCategories(settings.taskStatuses, ["done"]);
  const projectIds = [...new Set(tasks.map((t) => t.project).filter(Boolean) as string[])];
  const depIds = [...new Set(tasks.flatMap((t) => t.dependencies))];
  const taskIds = tasks.map((t) => t._id);

  const [projects, people, deps, subCounts] = await Promise.all([
    projectIds.length ? db().select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, manager: Project.manager, team: Project.team }).from(Project).where(inList(Project._id, projectIds)) : [],
    peopleMap(tasks.flatMap((t) => t.assignees)),
    depIds.length ? db().select({ _id: Task._id, status: Task.status }).from(Task).where(inList(Task._id, depIds)) : [],
    db()
      .select({ parent: Task.parent, total: count(), done: sql<number>`coalesce(sum(case when ${inList(Task.status, doneKeys)} then 1 else 0 end), 0)`.mapWith(Number) })
      .from(Task)
      .where(inList(Task.parent, taskIds))
      .groupBy(Task.parent),
  ]);
  const projectMap = new Map(projects.map((p) => [p._id, p]));
  const depStatus = new Map(deps.map((d) => [d._id, d.status]));
  const subMap = new Map(subCounts.map((s) => [s.parent, s]));
  const today = todayKey();

  return tasks.map((t) => {
    const project = t.project ? projectMap.get(t.project) : undefined;
    const caps = taskCaps(user, t, project);
    const open = !closedKeys.includes(t.status);
    const unmetDeps = t.dependencies.some((d) => {
      const s = depStatus.get(d);
      return s !== undefined && !closedKeys.includes(s);
    });
    const category = categoryOf(settings.taskStatuses, t.status);
    const subs = subMap.get(t._id);
    return {
      id: t._id,
      taskNo: t.taskNo,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate ?? undefined,
      daysLate: open && t.dueDate && t.dueDate < today ? diffDays(t.dueDate, today) : 0,
      projectId: project?._id,
      projectNo: project?.projectNo,
      projectTitle: project?.title,
      assignees: t.assignees.map((a) => {
        const p = people.get(a);
        return { name: p?.name ?? "Unknown", photo: p?.photo, intern: p?.personType === "intern" || p?.personType === "trainee" };
      }),
      estimateHours: t.estimateHours,
      progress: t.progress,
      isLearning: t.isLearning,
      blocked: open && (category === "blocked" || unmetDeps),
      blockerNote: t.blocker || undefined,
      subtasks: { done: subs?.done ?? 0, total: subs?.total ?? 0 },
      allowedStatuses: allowedTaskStatuses(settings, caps, t),
    };
  });
}
