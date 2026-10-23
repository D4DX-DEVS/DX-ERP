import "server-only";
import { connectDB } from "@/lib/db";
import { Project, Task, Types, type ITask } from "@/lib/models";
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

export const TASK_ROW_FIELDS = {
  taskNo: 1,
  title: 1,
  status: 1,
  priority: 1,
  dueDate: 1,
  project: 1,
  assignees: 1,
  estimateHours: 1,
  progress: 1,
  isLearning: 1,
  dependencies: 1,
  blocker: 1,
  reviewer: 1,
  reporter: 1,
} as const;

/** Builds list/board rows for lean tasks: project labels, assignee names, blocked flag, subtask counts and allowed status changes. */
export async function toTaskRows(user: CurrentUser, tasks: TaskLean[], settings: AppSettings): Promise<TaskRow[]> {
  if (tasks.length === 0) return [];
  await connectDB();
  const closedKeys = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const doneKeys = keysInCategories(settings.taskStatuses, ["done"]);
  const projectIds = [...new Set(tasks.map((t) => t.project?.toString()).filter(Boolean) as string[])];
  const depIds = [...new Set(tasks.flatMap((t) => t.dependencies.map((d) => d.toString())))];
  const taskIds = tasks.map((t) => t._id);

  const [projects, people, deps, subCounts] = await Promise.all([
    projectIds.length ? Project.find({ _id: { $in: projectIds } }, { projectNo: 1, title: 1, manager: 1 }).lean() : [],
    peopleMap(tasks.flatMap((t) => t.assignees)),
    depIds.length ? Task.find({ _id: { $in: depIds } }, { status: 1 }).lean() : [],
    Task.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
      { $match: { parent: { $in: taskIds } } },
      { $group: { _id: "$parent", total: { $sum: 1 }, done: { $sum: { $cond: [{ $in: ["$status", doneKeys] }, 1, 0] } } } },
    ]),
  ]);
  const projectMap = new Map(projects.map((p) => [p._id.toString(), p]));
  const depStatus = new Map(deps.map((d) => [d._id.toString(), d.status]));
  const subMap = new Map(subCounts.map((s) => [s._id.toString(), s]));
  const today = todayKey();

  return tasks.map((t) => {
    const project = t.project ? projectMap.get(t.project.toString()) : undefined;
    const caps = taskCaps(user, t, project?.manager);
    const open = !closedKeys.includes(t.status);
    const unmetDeps = t.dependencies.some((d) => {
      const s = depStatus.get(d.toString());
      return s !== undefined && !closedKeys.includes(s);
    });
    const category = categoryOf(settings.taskStatuses, t.status);
    const subs = subMap.get(t._id.toString());
    return {
      id: t._id.toString(),
      taskNo: t.taskNo,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      daysLate: open && t.dueDate && t.dueDate < today ? diffDays(t.dueDate, today) : 0,
      projectId: project?._id.toString(),
      projectNo: project?.projectNo,
      projectTitle: project?.title,
      assignees: t.assignees.map((a) => {
        const p = people.get(a.toString());
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
