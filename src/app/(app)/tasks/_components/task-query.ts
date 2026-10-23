import "server-only";
import { Task } from "@/lib/models";
import type { Filter } from "@/lib/work-access";
import { TASK_ROW_FIELDS, type TaskLean } from "./task-rows";

/**
 * One page of tasks: open work first, soonest due date first (tasks without a due date last).
 * `match` must already contain real ObjectIds because aggregation does not cast.
 */
export function queryTasks(match: Filter, closedKeys: string[], skip: number, limit: number): Promise<TaskLean[]> {
  return Task.aggregate<TaskLean>([
    { $match: match },
    { $addFields: { _closed: { $in: ["$status", closedKeys] }, _due: { $ifNull: ["$dueDate", "9999-12-31"] } } },
    { $sort: { _closed: 1, _due: 1, createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    { $project: { ...TASK_ROW_FIELDS } },
  ]);
}
