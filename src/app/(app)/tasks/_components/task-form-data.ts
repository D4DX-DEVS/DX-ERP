import "server-only";
import { and, desc, eq, or } from "drizzle-orm";
import { Project, Task, type Id } from "@/lib/models";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { peopleOptions } from "@/lib/people";
import type { AppSettings } from "@/lib/config-defaults";
import { inList, notInList } from "@/lib/sql";
import { keysInCategories, PROJECT_CLOSED_CATEGORIES, projectFilter, taskFilter } from "@/lib/work-access";
import type { TaskFormDependency, TaskFormProject } from "./task-form";

/** Projects the user may create tasks in, with milestones, plus candidate dependencies and people. */
export async function loadTaskFormOptions(user: CurrentUser, settings: AppSettings, extraProjectIds: Id[] = []) {
  const closed = keysInCategories(settings.projectStatuses, PROJECT_CLOSED_CATEGORIES);
  const base = can(user, "tasks.manage") ? projectFilter(user) : eq(Project.manager, user._id);
  const projects = await db()
    .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, milestones: Project.milestones })
    .from(Project)
    .where(or(and(base, notInList(Project.status, closed)), extraProjectIds.length ? inList(Project._id, extraProjectIds) : undefined))
    .orderBy(desc(Project.projectNo))
    .limit(300);
  const projectIds = projects.map((p) => p._id);
  const [tasks, people] = await Promise.all([
    projectIds.length
      ? db()
          .select({ _id: Task._id, taskNo: Task.taskNo, title: Task.title, project: Task.project, parent: Task.parent })
          .from(Task)
          .where(and(inList(Task.project, projectIds), await taskFilter(user)))
          .orderBy(desc(Task.createdAt))
          .limit(800)
      : [],
    peopleOptions(),
  ]);
  const formProjects: TaskFormProject[] = projects.map((p) => ({
    id: p._id,
    label: `${p.projectNo} · ${p.title}`,
    milestones: p.milestones.map((m) => ({ id: m._id, title: m.title })),
  }));
  const dependencies: TaskFormDependency[] = tasks.map((t) => ({ id: t._id, label: `${t.taskNo} · ${t.title}`, project: t.project ?? "", topLevel: !t.parent }));
  return { projects: formProjects, dependencies, people };
}
