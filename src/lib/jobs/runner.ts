import "server-only";
import { connectDB } from "@/lib/db";
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
  const filter = force
    ? { _id: name, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] }
    : {
        _id: name,
        $and: [
          { $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
          { $or: [{ lastRunAt: null }, { lastRunAt: { $lt: dueBefore } }] },
        ],
      };
  try {
    const res = await SystemJob.findOneAndUpdate(filter, { $set: { lockedUntil: lockUntil } }, { upsert: true, returnDocument: "after" }).lean();
    return Boolean(res);
  } catch (error) {
    // Duplicate key on upsert = another instance holds the lock or the job is not due.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }
}

async function release(name: string, result: string): Promise<void> {
  await SystemJob.updateOne({ _id: name }, { $set: { lastRunAt: new Date(), lockedUntil: null, lastResult: result.slice(0, 500) } });
}

export async function runJobs(opts: { force?: boolean; only?: string[] } = {}): Promise<Record<string, string>> {
  await connectDB();
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
