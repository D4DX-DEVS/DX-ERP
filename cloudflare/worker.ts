/**
 * Workers entry point: the OpenNext-generated fetch handler (built by `opennextjs-cloudflare build`)
 * plus a Cron Trigger (see `triggers.crons` in wrangler.jsonc) that runs the scheduled jobs through
 * the app's own `/api/cron` route, authorised with CRON_SECRET. The job runner throttles each job
 * to its own interval, so the trigger can fire more often than any single job needs.
 */
// @ts-expect-error -- generated at build time
import { default as handler } from "../.open-next/worker.js";

const worker = {
  fetch: handler.fetch,

  async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    const secret = env.CRON_SECRET;
    if (!secret) {
      console.warn("[cron] CRON_SECRET is not set; scheduled run skipped");
      return;
    }
    // Each call goes through the Worker's own service binding, so it is a separate invocation with its own
    // D1 query budget (50 per request on the free plan). /api/cron runs a few due jobs per call and reports
    // how many are still pending.
    const run = async () => {
      for (let round = 0; round < 15; round++) {
        const res = await env.WORKER_SELF_REFERENCE.fetch(
          new Request(new URL("/api/cron?max=3", env.APP_URL || "https://localhost"), {
            method: "POST",
            headers: { authorization: `Bearer ${secret}` },
          }),
        );
        if (!res.ok) {
          console.error("[cron] run failed", res.status, await res.text());
          return;
        }
        const body = (await res.json()) as { pending?: number };
        if (!body.pending) return;
      }
    };
    ctx.waitUntil(run());
  },
};

export default worker;
