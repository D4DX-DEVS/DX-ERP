import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Task } from "@/lib/models";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { inList } from "@/lib/sql";
import type { Filter } from "@/lib/work-access";
import { TASK_ROW_FIELDS, toTaskRows, type TaskLean } from "./task-rows";
import type { BoardColumn } from "./task-board";

/**
 * One page of tasks: open work first, soonest due date first (tasks without a due date last).
 */
export async function queryTasks(match: Filter, closedKeys: string[], skip: number, limit: number): Promise<TaskLean[]> {
  return db()
    .select(TASK_ROW_FIELDS)
    .from(Task)
    .where(match)
    .orderBy(
      asc(sql`case when ${inList(Task.status, closedKeys)} then 1 else 0 end`),
      asc(sql`coalesce(${Task.dueDate}, '9999-12-31')`),
      desc(Task.createdAt),
    )
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
