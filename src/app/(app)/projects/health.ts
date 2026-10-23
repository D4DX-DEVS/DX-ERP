import { diffDays } from "@/lib/time";

export type Health = "ok" | "risk" | "late" | "na";

export const HEALTH_LABEL: Record<Health, string> = { ok: "On track", risk: "At risk", late: "Delayed", na: "—" };
export const HEALTH_TONE: Record<Health, "green" | "amber" | "red" | "gray"> = { ok: "green", risk: "amber", late: "red", na: "gray" };

/** A milestone is overdue when it is past its due date and has not been delivered. */
/** Client-approved and delivered milestones are complete and can never become overdue. */
export function milestoneOverdue(m: { dueDate?: string; status: string }, today: string): boolean {
  return m.status !== "delivered" && m.status !== "approved" && Boolean(m.dueDate) && m.dueDate! < today;
}

/** Share of the planned period that has elapsed (0–100), or undefined without both dates. */
export function elapsedPercent(start: string | undefined, target: string | undefined, today: string): number | undefined {
  if (!start || !target) return undefined;
  const total = diffDays(start, target);
  if (total <= 0) return today >= target ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((diffDays(start, today) / total) * 100)));
}

/**
 * Project health (FRS §4.4 / design): Delayed when past the target date and not completed, or any
 * milestone is delayed / overdue; At risk when progress trails elapsed time by more than 15 points.
 */
export function projectHealth(input: {
  category?: string;
  startDate?: string;
  targetDate?: string;
  progress: number;
  milestones: { dueDate?: string; status: string }[];
  today: string;
}): Health {
  const { category, startDate, targetDate, progress, milestones, today } = input;
  if (category === "completed" || category === "cancelled" || category === "enquiry") return "na";
  if ((targetDate && targetDate < today) || milestones.some((m) => m.status === "delayed" || milestoneOverdue(m, today))) return "late";
  const elapsed = elapsedPercent(startDate, targetDate, today);
  if (elapsed !== undefined && elapsed - progress > 15) return "risk";
  return "ok";
}

export interface TaskStatRow {
  status: string;
  count: number;
  estimate: number;
  withEstimate: number;
}

/**
 * Progress = done tasks / total, weighted by estimate when present (tasks without an estimate count
 * as the average estimate). Cancelled tasks are ignored.
 */
export function weightedProgress(rows: TaskStatRow[], doneKeys: string[], cancelledKeys: string[]): { progress: number; total: number; done: number } {
  const live = rows.filter((r) => !cancelledKeys.includes(r.status));
  const total = live.reduce((s, r) => s + r.count, 0);
  const done = live.filter((r) => doneKeys.includes(r.status)).reduce((s, r) => s + r.count, 0);
  if (total === 0) return { progress: 0, total: 0, done: 0 };
  const estSum = live.reduce((s, r) => s + r.estimate, 0);
  const withEst = live.reduce((s, r) => s + r.withEstimate, 0);
  if (withEst === 0) return { progress: Math.round((done / total) * 100), total, done };
  const avg = estSum / withEst;
  const weight = (r: TaskStatRow) => r.estimate + (r.count - r.withEstimate) * avg;
  const totalWeight = live.reduce((s, r) => s + weight(r), 0);
  const doneWeight = live.filter((r) => doneKeys.includes(r.status)).reduce((s, r) => s + weight(r), 0);
  return { progress: totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0, total, done };
}
