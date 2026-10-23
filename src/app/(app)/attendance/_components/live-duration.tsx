"use client";

import { useNow } from "@/components/ui/use-now";
import { formatDuration } from "@/lib/time";

/**
 * A duration that keeps counting up while `running`. `baseMinutes` is the value at `renderedAt`
 * (epoch ms, from the server render); until the clock is available it shows the server value.
 */
export function LiveDuration({ baseMinutes, renderedAt, running, className }: { baseMinutes: number; renderedAt: number; running: boolean; className?: string }) {
  const now = useNow(15_000);
  const extra = running && now !== null ? Math.max(0, Math.floor((now - renderedAt) / 60_000)) : 0;
  return <span className={className}>{formatDuration(baseMinutes + extra)}</span>;
}
