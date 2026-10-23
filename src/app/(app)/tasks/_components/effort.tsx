import { cn } from "@/lib/cn";

/** Bar = hours logged, tick = estimate (design: "Estimated vs actual"). */
export function EffortBar({ actualHours, estimateHours, className }: { actualHours: number; estimateHours: number; className?: string }) {
  const max = Math.max(actualHours, estimateHours, 0.0001);
  const over = estimateHours > 0 && actualHours > estimateHours;
  return (
    <div
      className={cn("relative h-2 rounded-full bg-track", className)}
      role="img"
      aria-label={estimateHours > 0 ? `${actualHours.toFixed(1)} hours logged of ${estimateHours} estimated` : `${actualHours.toFixed(1)} hours logged, no estimate`}
    >
      <div className={cn("h-full rounded-full", over ? "bg-chart-2" : "bg-chart-1")} style={{ width: `${Math.min(100, (actualHours / max) * 100)}%` }} />
      {estimateHours > 0 && <div className="absolute -top-[3px] h-3.5 w-0.5 bg-ink" style={{ left: `${Math.min(100, (estimateHours / max) * 100)}%` }} aria-hidden />}
    </div>
  );
}

/** "18.5" / "16" style hour figure used next to effort bars. */
export function hoursLabel(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}
