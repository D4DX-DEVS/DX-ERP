import "server-only";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, gte, lte } from "drizzle-orm";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { runBatch } from "@/lib/domain/batch";
import { workCalendar } from "@/lib/domain/calendar";
import { LeaveRequest } from "@/lib/models";
import { inList } from "@/lib/sql";
import { leaveDaysIn } from "../../attendance/_lib/leave-days";

/**
 * Re-counts the days of pending and approved leave that covers any of `dates` after the holiday calendar changed, so
 * a holiday declared after someone applied is no longer deducted from their balance (and a removed holiday is).
 * Returns the number of requests whose day count changed.
 */
export async function recountLeaveDays(settings: AppSettings, dates: string[]): Promise<number> {
  if (dates.length === 0) return 0;
  const sorted = [...dates].sort();
  const candidates = await db()
    .select({ _id: LeaveRequest._id, startDate: LeaveRequest.startDate, endDate: LeaveRequest.endDate, halfDay: LeaveRequest.halfDay, days: LeaveRequest.days })
    .from(LeaveRequest)
    .where(and(inList(LeaveRequest.status, ["pending_manager", "pending_hr", "approved"]), lte(LeaveRequest.startDate, sorted[sorted.length - 1]), gte(LeaveRequest.endDate, sorted[0])));
  const affected = candidates.filter((r) => dates.some((d) => d >= r.startDate && d <= r.endDate));
  if (affected.length === 0) return 0;

  const from = affected.reduce((min, r) => (r.startDate < min ? r.startDate : min), affected[0].startDate);
  const to = affected.reduce((max, r) => (r.endDate > max ? r.endDate : max), affected[0].endDate);
  const cal = await workCalendar(settings, from, to);
  const writes: BatchItem<"sqlite">[] = [];
  for (const r of affected) {
    const count = leaveDaysIn(settings, cal, r.startDate, r.endDate).length;
    const days = r.halfDay ? (count ? 0.5 : 0) : count;
    if (days !== r.days) writes.push(db().update(LeaveRequest).set({ days }).where(eq(LeaveRequest._id, r._id)));
  }
  await runBatch(writes);
  return writes.length;
}
