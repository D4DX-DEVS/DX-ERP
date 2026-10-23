import "server-only";
import { Task, TimesheetEntry, type ObjectId } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { keysInCategories } from "@/lib/work-access";
import { weightedProgress, type TaskStatRow } from "./health";

export interface ProjectTaskStats {
  progress: number;
  total: number;
  done: number;
}

/** Task progress per project (top-level tasks only, weighted by estimate). */
export async function projectTaskStats(projectIds: ObjectId[], settings: AppSettings): Promise<Map<string, ProjectTaskStats>> {
  const out = new Map<string, ProjectTaskStats>();
  if (projectIds.length === 0) return out;
  const rows = await Task.aggregate<{ _id: { project: ObjectId; status: string }; count: number; estimate: number; withEstimate: number }>([
    { $match: { project: { $in: projectIds }, parent: null } },
    {
      $group: {
        _id: { project: "$project", status: "$status" },
        count: { $sum: 1 },
        estimate: { $sum: "$estimateHours" },
        withEstimate: { $sum: { $cond: [{ $gt: ["$estimateHours", 0] }, 1, 0] } },
      },
    },
  ]);
  const byProject = new Map<string, TaskStatRow[]>();
  for (const r of rows) {
    const key = r._id.project.toString();
    byProject.set(key, [...(byProject.get(key) ?? []), { status: r._id.status, count: r.count, estimate: r.estimate, withEstimate: r.withEstimate }]);
  }
  const doneKeys = keysInCategories(settings.taskStatuses, ["done"]);
  const cancelledKeys = keysInCategories(settings.taskStatuses, ["cancelled"]);
  for (const id of projectIds) out.set(id.toString(), weightedProgress(byProject.get(id.toString()) ?? [], doneKeys, cancelledKeys));
  return out;
}

/** Minutes logged per project (draft, submitted and approved entries; rejected ones are excluded). */
export async function projectLoggedMinutes(projectIds: ObjectId[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await TimesheetEntry.aggregate<{ _id: ObjectId; minutes: number }>([
    { $match: { project: { $in: projectIds }, status: { $ne: "rejected" } } },
    { $group: { _id: "$project", minutes: { $sum: "$minutes" } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.minutes]));
}
