import "server-only";
import { movementJobs } from "./movement";
import { timeJobs } from "./time";
import { adminJobs } from "./admin";
import { salesJobs } from "./sales";
import { workJobs } from "./work";
import { coreJobs } from "./core";
import { peopleJobs } from "./people";
import { financeJobs } from "./finance";

export interface Job {
  name: string;
  /** Minimum minutes between runs. */
  intervalMinutes: number;
  /** Returns a short summary for the job log. */
  run: () => Promise<string | void>;
}

/** Registered scheduled jobs (see lib/jobs/runner.ts). */
export const JOBS: Job[] = [...movementJobs, ...timeJobs, ...adminJobs, ...salesJobs, ...workJobs, ...peopleJobs, ...financeJobs, ...coreJobs];
