import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { SystemJob } from "@/lib/models";
import { JOBS } from "./registry";

/**
 * Scheduled automation (reminders, overdue flags, retention, backups — FRS §1.1 item 8, §18).
 * Triggered by the cron endpoint (/api/cron), which a Cloudflare Cron Trigger calls every 15 minutes
 * (cloudflare/worker.ts). Each job is throttled by its interval and guarded by a short DB lock so
 * concurrent instances never run the same job twice.
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

export interface JobRunResult {
  results: Record<string, string>;
  /** Due jobs left for a later call because this call reached `maxJobs`. */
  pending: number;
}

/**
 * Runs the due jobs (all of them with `force`), at most `maxJobs` per call. On the Workers Free plan a request
 * may make 50 D1 queries, so the cron trigger runs a few jobs per request and calls again while `pending > 0`
 * (see cloudflare/worker.ts). Job state is read in one query; each job then costs a lock + release query plus its own work.
 */
export async function runJobs(opts: { force?: boolean; only?: string[]; maxJobs?: number } = {}): Promise<JobRunResult> {
  const results: Record<string, string> = {};
  const now = Date.now();
  const state = new Map((await db().select().from(SystemJob)).map((j) => [j._id, j]));
  const due = JOBS.filter((job) => {
    if (opts.only && !opts.only.includes(job.name)) return false;
    const s = state.get(job.name);
    if (s?.lockedUntil && s.lockedUntil.getTime() > now) return false;
    return opts.force || !s?.lastRunAt || s.lastRunAt.getTime() < now - job.intervalMinutes * 60_000;
  });
  const batch = due.slice(0, opts.maxJobs ?? due.length);
  for (const job of batch) {
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
  return { results, pending: due.length - batch.length };
}
