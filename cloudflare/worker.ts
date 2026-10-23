/**
 * Workers entry point: the OpenNext-generated fetch handler (built by `opennextjs-cloudflare build`)
 * plus a Cron Trigger (see `triggers.crons` in wrangler.jsonc) that runs the scheduled jobs through
 * the app's own `/api/cron` route, authorised with CRON_SECRET. The job runner throttles each job
 * to its own interval, so the trigger can fire more often than any single job needs.
 */
// @ts-expect-error -- generated at build time
import { default as handler } from "../.open-next/worker.js";

export default {
  fetch: handler.fetch,

  async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    const secret = env.CRON_SECRET;
    if (!secret) {
      console.warn("[cron] CRON_SECRET is not set; scheduled run skipped");
      return;
    }
    const request = new Request(new URL("/api/cron", env.APP_URL || "https://localhost"), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    ctx.waitUntil(
      handler.fetch(request, env, ctx).then(async (res: Response) => {
        if (!res.ok) console.error("[cron] run failed", res.status, await res.text());
      }),
    );
  },
};
