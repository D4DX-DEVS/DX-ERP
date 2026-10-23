import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { WidgetBoundary } from "./widget-boundary";

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full min-h-32 flex-col gap-3 rounded-[14px] border border-line bg-white p-5", className)} aria-busy="true" aria-label="Loading">
      <div className="h-3 w-1/3 animate-pulse rounded bg-track" />
      <div className="h-7 w-1/2 animate-pulse rounded bg-track" />
      <div className="mt-auto h-3 w-2/3 animate-pulse rounded bg-track" />
    </div>
  );
}

/**
 * A dashboard grid cell: streams in on its own (Suspense) and fails on its own (error boundary).
 * `className` controls placement in the grid; the card inside should fill the cell (`h-full`).
 */
export function Widget({ title, className, children, tall }: { title: string; className?: string; children: ReactNode; tall?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <WidgetBoundary title={title}>
        <Suspense fallback={<Skeleton className={tall ? "min-h-64" : undefined} />}>{children}</Suspense>
      </WidgetBoundary>
    </div>
  );
}
