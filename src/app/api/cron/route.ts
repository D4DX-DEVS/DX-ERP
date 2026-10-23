import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runJobs } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** `Authorization: Bearer <CRON_SECRET>`; always rejects when no secret is configured. */
function authorised(request: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return timingSafeEqual(sha256(match[1].trim()), sha256(secret));
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorised(request)) {
    if (!env.cronSecret) console.warn("[cron] request rejected: CRON_SECRET is not configured");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const params = new URL(request.url).searchParams;
  const force = ["1", "true", "yes"].includes((params.get("force") ?? "").toLowerCase());
  const only = params.get("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  // Jobs per request (D1 allows 50 queries per request on the free plan); the caller repeats while `pending > 0`.
  const max = Number.parseInt(params.get("max") ?? "", 10);
  // Forced runs continue across calls: later calls pass back the `since` of the first one.
  const sinceParam = new Date(params.get("since") ?? "");
  try {
    const startedAt = new Date();
    const since = force ? (Number.isNaN(sinceParam.getTime()) ? startedAt : sinceParam) : undefined;
    const { results, pending } = await runJobs({ force, only: only?.length ? only : undefined, maxJobs: Number.isFinite(max) && max > 0 ? max : 3, since });
    return NextResponse.json(
      { ok: true, startedAt: startedAt.toISOString(), force, since: since?.toISOString(), results, pending },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron] run failed", error);
    return NextResponse.json({ ok: false, error: "Job run failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = handle;
export const POST = handle;
