import "server-only";
import { Client, type IProject } from "@/lib/models";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { connectDB } from "@/lib/db";
import { canSeeClient, categoryOf, peopleMap, type PersonLite } from "@/lib/work-access";
import { diffDays, fmtDate, todayKey } from "@/lib/time";
import { projectHealth, milestoneOverdue, type Health } from "./health";
import { projectLoggedMinutes, projectTaskStats } from "./stats";

export type ProjectLean = Pick<IProject, "_id" | "projectNo" | "title" | "client" | "internal" | "manager" | "team" | "startDate" | "targetDate" | "status" | "milestones" | "estimatedHours" | "priority">;

export const PROJECT_ROW_FIELDS = { projectNo: 1, title: 1, client: 1, internal: 1, manager: 1, team: 1, startDate: 1, targetDate: 1, status: 1, milestones: 1, estimatedHours: 1, priority: 1 } as const;

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
  await connectDB();
  const ids = projects.map((p) => p._id);
  const restricted = user.personType === "intern" || user.personType === "trainee";
  const clientIds = projects.flatMap((p) => (p.client ? [p.client] : []));
  const [stats, logged, people, clients] = await Promise.all([
    projectTaskStats(ids, settings),
    restricted ? new Map<string, number>() : projectLoggedMinutes(ids),
    peopleMap(projects.flatMap((p) => [p.manager, ...p.team.map((m) => m.user)])),
    !restricted && clientIds.length ? Client.find({ _id: { $in: clientIds } }, { name: 1, confidential: 1, owner: 1 }).lean() : [],
  ]);
  const clientMap = new Map(clients.map((c) => [c._id.toString(), c]));
  const today = todayKey();

  return projects.map((p) => {
    const s = stats.get(p._id.toString()) ?? { progress: 0, total: 0, done: 0 };
    const category = categoryOf(settings.projectStatuses, p.status);
    const client = p.client ? clientMap.get(p.client.toString()) : undefined;
    let clientName: string | undefined;
    if (!restricted) clientName = p.internal ? "Internal" : client ? (canSeeClient(user, client) ? client.name : "Restricted client") : "—";
    return {
      id: p._id.toString(),
      projectNo: p.projectNo,
      title: p.title,
      clientName,
      manager: p.manager ? people.get(p.manager.toString()) : undefined,
      team: p.team.map((m) => people.get(m.user.toString())).filter((x): x is PersonLite => Boolean(x)),
      startDate: p.startDate,
      targetDate: p.targetDate,
      timeline: p.startDate && p.targetDate ? `${fmtDate(p.startDate, "d MMM")} – ${fmtDate(p.targetDate, "d MMM")}` : p.targetDate ? `Due ${fmtDate(p.targetDate, "d MMM yyyy")}` : "Not scheduled",
      status: p.status,
      category,
      progress: s.progress,
      tasksDone: s.done,
      tasksTotal: s.total,
      nextMilestone: category === "completed" ? "Delivered" : nextMilestoneLabel(p.milestones, today),
      loggedHours: (logged.get(p._id.toString()) ?? 0) / 60,
      estimatedHours: p.estimatedHours,
      showEffort: !restricted,
      health: projectHealth({ category, startDate: p.startDate, targetDate: p.targetDate, progress: s.progress, milestones: p.milestones, today }),
    };
  });
}
