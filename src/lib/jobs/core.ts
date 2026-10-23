import "server-only";
import type { Job } from "./registry";

/**
 * Core scheduled jobs. Notification and audit-log retention purging is handled by the admin
 * module's `data-retention` job (src/lib/jobs/admin.ts), so there is nothing to register here yet.
 */
export const coreJobs: Job[] = [];
