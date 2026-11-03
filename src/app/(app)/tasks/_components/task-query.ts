import "server-only";
import { and, asc, count, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { Task, type Id } from "@/lib/models";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { inList, jsonHas, nocase } from "@/lib/sql";
import type { SortChoices } from "@/lib/query";
import type { Filter } from "@/lib/work-access";
import { TASK_ROW_FIELDS, toTaskRows, type TaskLean } from "./task-rows";
import type { BoardColumn } from "./task-board";

/** Task lists and boards show top-level tasks only; subtasks are listed on their parent's page. */
export const topLevelTask = (): SQL => isNull(Task.parent);

/** Assigned to `userId` directly, or through one of its subtasks (so subtask-only assignees still find their work). */
export function assignedToTaskOrSubtask(userId: Id): SQL {
  return or(
    jsonHas(Task.assignees, userId),
    sql`exists (select 1 from ${Task} as sub where sub.parent = ${Task._id} and exists (select 1 from json_each(sub.assignees) where value = ${userId}))`,
  )!;
}

const openFirst = (closedKeys: string[]) => asc(sql`case when ${inList(Task.status, closedKeys)} then 1 else 0 end`);
const dueSoonest = asc(sql`coalesce(${Task.dueDate}, '9999-12-31')`);

/** Sort choices for task lists (`sortParam(sp, TASK_SORTS)`); the default puts open work first, soonest due first. */
export const TASK_SORTS = {
  due: { label: "Due date", order: (closedKeys: string[]) => [openFirst(closedKeys), dueSoonest, desc(Task.createdAt)] },
  priority: {
    label: "Priority (highest first)",
    order: (closedKeys: string[]) => [openFirst(closedKeys), asc(sql`case ${Task.priority} when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`), dueSoonest],
  },
  newest: { label: "Newest first", order: () => [desc(Task.createdAt)] },
  oldest: { label: "Oldest first", order: () => [asc(Task.createdAt)] },
  updated: { label: "Recently updated", order: () => [desc(Task.updatedAt)] },
  title: { label: "Title A–Z", order: () => [asc(nocase(Task.title))] },
} satisfies SortChoices<(closedKeys: string[]) => SQL[]>;

/**
 * One page of tasks, by default open work first, soonest due date first (tasks without a due date last).
 */
export async function queryTasks(match: Filter, closedKeys: string[], skip: number, limit: number, order = TASK_SORTS.due.order): Promise<TaskLean[]> {
  return db()
    .select(TASK_ROW_FIELDS)
    .from(Task)
    .where(match)
    .orderBy(...order(closedKeys))
    .limit(limit)
    .offset(skip);
}

/**
 * Board columns (one per status): the first `limit` tasks of each status in the list order plus the
 * status total. One query per column, one grouped count, and a single `toTaskRows` for all columns.
 */
export async function queryTaskBoard(user: CurrentUser, settings: AppSettings, match: Filter, closedKeys: string[], limit: number): Promise<BoardColumn[]> {
  const statuses = settings.taskStatuses;
  const [perStatus, totalRows] = await Promise.all([
    Promise.all(statuses.map((s) => queryTasks(and(match, eq(Task.status, s.key)), closedKeys, 0, limit))),
    db().select({ status: Task.status, n: count() }).from(Task).where(match).groupBy(Task.status),
  ]);
  const rows = await toTaskRows(user, perStatus.flat(), settings);
  const totals = new Map(totalRows.map((r) => [r.status, r.n]));
  let offset = 0;
  return statuses.map((s, i) => {
    const size = perStatus[i].length;
    const column = { status: s, rows: rows.slice(offset, offset + size), total: totals.get(s.key) ?? 0 };
    offset += size;
    return column;
  });
}
