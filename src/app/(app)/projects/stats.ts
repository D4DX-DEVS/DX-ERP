import "server-only";
import { and, count, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Task, TimesheetEntry, type Id } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { inList } from "@/lib/sql";
import { keysInCategories } from "@/lib/work-access";
import { weightedProgress, type TaskStatRow } from "./health";

export interface ProjectTaskStats {
  progress: number;
  total: number;
  done: number;
}

/** Task progress per project (top-level tasks only, weighted by estimate). */
export async function projectTaskStats(projectIds: Id[], settings: AppSettings): Promise<Map<string, ProjectTaskStats>> {
  const out = new Map<string, ProjectTaskStats>();
  if (projectIds.length === 0) return out;
  const rows = await db()
    .select({
      project: Task.project,
      status: Task.status,
      count: count(),
      estimate: sql<number>`coalesce(sum(${Task.estimateHours}), 0)`.mapWith(Number),
      withEstimate: sql<number>`coalesce(sum(case when ${Task.estimateHours} > 0 then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(Task)
    .where(and(inList(Task.project, projectIds), isNull(Task.parent)))
    .groupBy(Task.project, Task.status);
  const byProject = new Map<string, TaskStatRow[]>();
  for (const r of rows) {
    if (!r.project) continue;
    byProject.set(r.project, [...(byProject.get(r.project) ?? []), { status: r.status, count: r.count, estimate: r.estimate, withEstimate: r.withEstimate }]);
  }
  const doneKeys = keysInCategories(settings.taskStatuses, ["done"]);
  const cancelledKeys = keysInCategories(settings.taskStatuses, ["cancelled"]);
  for (const id of projectIds) out.set(id, weightedProgress(byProject.get(id) ?? [], doneKeys, cancelledKeys));
  return out;
}

/** Minutes logged per project (draft, submitted and approved entries; rejected ones are excluded). */
export async function projectLoggedMinutes(projectIds: Id[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db()
    .select({ project: TimesheetEntry.project, minutes: sql<number>`coalesce(sum(${TimesheetEntry.minutes}), 0)`.mapWith(Number) })
    .from(TimesheetEntry)
    .where(and(inList(TimesheetEntry.project, projectIds), ne(TimesheetEntry.status, "rejected")))
    .groupBy(TimesheetEntry.project);
  return new Map(rows.flatMap((r) => (r.project ? [[r.project, r.minutes] as [string, number]] : [])));
}
