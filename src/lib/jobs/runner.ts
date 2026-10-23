import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { SystemJob } from "@/lib/models";
import { JOBS } from "./registry";

/**
 * Scheduled automation (reminders, overdue flags, retention, backups — FRS §1.1 item 8, §18).
 * Triggered by the cron endpoint (/api/cron) and opportunistically from page loads, so it
 * works even where no external scheduler is configured. Each job is throttled by its interval
 * and guarded by a short DB lock so concurrent instances never run the same job twice.
 */
async function acquire(name: string, intervalMinutes: number, force: boolean): Promise<boolean> {
  const now = new Date();
  const dueBefore = new Date(now.getTime() - intervalMinutes * 60_000);
  const lockUntil = new Date(now.getTime() + 5 * 60_000);
  const unlocked = or(isNull(SystemJob.lockedUntil), lt(SystemJob.lockedUntil, now));
  const due = or(isNull(SystemJob.lastRunAt), lt(SystemJob.lastRunAt, dueBefore));
  // Atomic: a new job row is inserted locked; an existing row is only re-locked when free (and due).
  // No row comes back when another instance holds the lock or the job is not due yet.
  const rows = await db()
    .insert(SystemJob)
    .values({ _id: name, lockedUntil: lockUntil })
    .onConflictDoUpdate({ target: SystemJob._id, set: { lockedUntil: lockUntil }, setWhere: force ? unlocked : and(unlocked, due) })
    .returning({ id: SystemJob._id });
  return rows.length > 0;
}

async function release(name: string, result: string): Promise<void> {
  await db()
    .update(SystemJob)
    .set({ lastRunAt: new Date(), lockedUntil: null, lastResult: result.slice(0, 500) })
    .where(eq(SystemJob._id, name));
}

export async function runJobs(opts: { force?: boolean; only?: string[] } = {}): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const job of JOBS) {
    if (opts.only && !opts.only.includes(job.name)) continue;
    if (!(await acquire(job.name, job.intervalMinutes, Boolean(opts.force)))) {
      results[job.name] = "skipped";
      continue;
    }
    try {
      const out = await job.run();
      results[job.name] = out || "ok";
      await release(job.name, results[job.name]);
    } catch (error) {
      console.error(`[jobs] ${job.name} failed`, error);
      results[job.name] = `error: ${(error as Error).message}`;
      await release(job.name, results[job.name]);
    }
  }
  return results;
}

let lastOpportunistic = 0;

/** Cheap check called after page renders; runs due jobs at most once a minute per instance. */
export async function maybeRunJobs(): Promise<void> {
  if (Date.now() - lastOpportunistic < 60_000) return;
  lastOpportunistic = Date.now();
  try {
    await runJobs();
  } catch (error) {
    console.error("[jobs] opportunistic run failed", error);
  }
}
