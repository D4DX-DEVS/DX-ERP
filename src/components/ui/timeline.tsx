import type { ReactNode } from "react";
import { fmtDateTime } from "@/lib/time";
import { cn } from "@/lib/cn";

export interface TimelineItem {
  id?: string;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
  at?: string | Date | null;
  tone?: "default" | "success" | "danger" | "warning";
}

/** Vertical history list (task history, approvals, lifecycle events, corrections). */
export function Timeline({ items, empty = "No history yet.", className }: { items: TimelineItem[]; empty?: string; className?: string }) {
  if (items.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ol className={cn("relative flex flex-col gap-4 pl-5", className)}>
      <span className="absolute top-1.5 bottom-1.5 left-[5px] w-px bg-line" aria-hidden />
      {items.map((item, i) => (
        <li key={item.id ?? i} className="relative">
          <span
            className={cn(
              "absolute top-1.5 -left-5 size-[11px] rounded-full border-2 border-white",
              item.tone === "success" && "bg-success",
              item.tone === "danger" && "bg-danger",
              item.tone === "warning" && "bg-warning",
              (!item.tone || item.tone === "default") && "bg-brand-500",
            )}
            aria-hidden
          />
          <div className="text-sm font-medium break-words text-ink">{item.title}</div>
          <div className="text-xs text-muted">
            {item.meta}
            {item.meta && item.at ? " · " : ""}
            {item.at ? fmtDateTime(item.at) : ""}
          </div>
          {item.body && <div className="mt-1 text-[13px] break-words whitespace-pre-line text-ink-2">{item.body}</div>}
        </li>
      ))}
    </ol>
  );
}
