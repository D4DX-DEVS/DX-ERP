import "server-only";
import { Client, Project, type IProject } from "@/lib/models";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { inList } from "@/lib/sql";
import { canSeeClient, categoryOf, peopleMap, type PersonLite } from "@/lib/work-access";
import { diffDays, fmtDate, todayKey } from "@/lib/time";
import { projectHealth, milestoneOverdue, type Health } from "./health";
import { projectLoggedMinutes, projectTaskStats } from "./stats";

export type ProjectLean = Pick<IProject, "_id" | "projectNo" | "title" | "client" | "internal" | "manager" | "team" | "startDate" | "targetDate" | "status" | "milestones" | "estimatedHours" | "priority">;

/** Columns selected for project list / board / timeline rows. */
export const PROJECT_ROW_FIELDS = {
  _id: Project._id,
  projectNo: Project.projectNo,
  title: Project.title,
  client: Project.client,
  internal: Project.internal,
  manager: Project.manager,
  team: Project.team,
  startDate: Project.startDate,
  targetDate: Project.targetDate,
  status: Project.status,
  milestones: Project.milestones,
  estimatedHours: Project.estimatedHours,
  priority: Project.priority,
};

export interface ProjectRow {
  id: string;
  projectNo: string;
  title: string;
  /** Undefined for restricted viewers (interns / trainees). */
  clientName?: string;
  manager?: PersonLite;
  team: PersonLite[];
  startDate?: string;
  targetDate?: string;
  timeline: string;
  status: string;
  category?: string;
  progress: number;
  tasksDone: number;
  tasksTotal: number;
  nextMilestone: string;
  loggedHours: number;
  estimatedHours: number;
  showEffort: boolean;
  health: Health;
}

function nextMilestoneLabel(milestones: ProjectLean["milestones"], today: string): string {
  if (milestones.length === 0) return "No milestones";
  const pending = milestones.filter((m) => m.status !== "delivered").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const next = pending[0];
  if (!next) return "All milestones delivered";
  if (next.dueDate && milestoneOverdue(next, today)) return `${next.title} · ${diffDays(next.dueDate, today)}d late`;
  return next.dueDate ? `${next.title} · ${fmtDate(next.dueDate, "d MMM")}` : next.title;
}

/** Progress, effort, health and display labels for a page of projects. */
export async function buildProjectRows(user: CurrentUser, projects: ProjectLean[], settings: AppSettings): Promise<ProjectRow[]> {
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p._id);
  const restricted = user.personType === "intern" || user.personType === "trainee";
  const clientIds = projects.flatMap((p) => (p.client ? [p.client] : []));
  const [stats, logged, people, clients] = await Promise.all([
    projectTaskStats(ids, settings),
    restricted ? new Map<string, number>() : projectLoggedMinutes(ids),
    peopleMap(projects.flatMap((p) => [p.manager, ...p.team.map((m) => m.user)])),
    !restricted && clientIds.length ? db().select({ _id: Client._id, name: Client.name, confidential: Client.confidential, owner: Client.owner }).from(Client).where(inList(Client._id, clientIds)) : [],
  ]);
  const clientMap = new Map(clients.map((c) => [c._id, c]));
  const today = todayKey();

  return projects.map((p) => {
    const s = stats.get(p._id) ?? { progress: 0, total: 0, done: 0 };
    const category = categoryOf(settings.projectStatuses, p.status);
    const client = p.client ? clientMap.get(p.client) : undefined;
    let clientName: string | undefined;
    if (!restricted) clientName = p.internal ? "Internal" : client ? (canSeeClient(user, client) ? client.name : "Restricted client") : "—";
    return {
      id: p._id,
      projectNo: p.projectNo,
      title: p.title,
      clientName,
      manager: p.manager ? people.get(p.manager) : undefined,
      team: p.team.map((m) => people.get(m.user)).filter((x): x is PersonLite => Boolean(x)),
      startDate: p.startDate ?? undefined,
      targetDate: p.targetDate ?? undefined,
      timeline: p.startDate && p.targetDate ? `${fmtDate(p.startDate, "d MMM")} – ${fmtDate(p.targetDate, "d MMM")}` : p.targetDate ? `Due ${fmtDate(p.targetDate, "d MMM yyyy")}` : "Not scheduled",
      status: p.status,
      category,
      progress: s.progress,
      tasksDone: s.done,
      tasksTotal: s.total,
      nextMilestone: category === "completed" ? "Delivered" : nextMilestoneLabel(p.milestones, today),
      loggedHours: (logged.get(p._id) ?? 0) / 60,
      estimatedHours: p.estimatedHours,
      showEffort: !restricted,
      health: projectHealth({ category, startDate: p.startDate ?? undefined, targetDate: p.targetDate ?? undefined, progress: s.progress, milestones: p.milestones, today }),
    };
  });
}
