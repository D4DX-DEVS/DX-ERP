import "server-only";
import { Project, Task, type ObjectId } from "@/lib/models";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { peopleOptions } from "@/lib/people";
import type { AppSettings } from "@/lib/config-defaults";
import { keysInCategories, PROJECT_CLOSED_CATEGORIES, projectFilter, taskFilter } from "@/lib/work-access";
import type { TaskFormDependency, TaskFormProject } from "./task-form";

/** Projects the user may create tasks in, with milestones, plus candidate dependencies and people. */
export async function loadTaskFormOptions(user: CurrentUser, settings: AppSettings, extraProjectIds: ObjectId[] = []) {
  await connectDB();
  const closed = keysInCategories(settings.projectStatuses, PROJECT_CLOSED_CATEGORIES);
  const base = can(user, "tasks.manage") ? projectFilter(user) : { manager: user._id };
  const projects = await Project.find(
    { $or: [{ $and: [base, { status: { $nin: closed } }] }, ...(extraProjectIds.length ? [{ _id: { $in: extraProjectIds } }] : [])] },
    { projectNo: 1, title: 1, milestones: 1 },
  )
    .sort({ projectNo: -1 })
    .limit(300)
    .lean();
  const projectIds = projects.map((p) => p._id);
  const [tasks, people] = await Promise.all([
    projectIds.length ? Task.find({ $and: [{ project: { $in: projectIds } }, await taskFilter(user)] }, { taskNo: 1, title: 1, project: 1, parent: 1 }).sort({ createdAt: -1 }).limit(800).lean() : [],
    peopleOptions(),
  ]);
  const formProjects: TaskFormProject[] = projects.map((p) => ({
    id: p._id.toString(),
    label: `${p.projectNo} · ${p.title}`,
    milestones: p.milestones.map((m) => ({ id: m._id.toString(), title: m.title })),
  }));
  const dependencies: TaskFormDependency[] = tasks.map((t) => ({ id: t._id.toString(), label: `${t.taskNo} · ${t.title}`, project: t.project?.toString() ?? "", topLevel: !t.parent }));
  return { projects: formProjects, dependencies, people };
}
