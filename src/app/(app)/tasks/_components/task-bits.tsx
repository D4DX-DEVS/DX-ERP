import { Ban } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StatusOption } from "@/lib/config-defaults";
import { fmtDate, todayKey } from "@/lib/time";
import type { StatusChoice } from "./task-status-menu";
import type { TaskRow } from "./task-rows";

/* Small pieces shared by the server task table and the client task board (no server-only imports). */

export function DueLabel({ row, className }: { row: Pick<TaskRow, "dueDate" | "daysLate">; className?: string }) {
  if (!row.dueDate) return <span className={cn("text-muted", className)}>No due date</span>;
  if (row.daysLate > 0) return <span className={cn("font-semibold text-danger", className)}>{row.daysLate}d late</span>;
  const label = row.dueDate === todayKey() ? "Today" : fmtDate(row.dueDate, "EEE d MMM");
  return <span className={cn("text-ink-2", className)}>{label}</span>;
}

export function choicesFor(row: TaskRow, statuses: StatusOption[]): { current: StatusChoice; choices: StatusChoice[] } {
  const toChoice = (s: StatusOption): StatusChoice => ({ key: s.key, label: s.label, tone: s.tone, category: s.category });
  const current = statuses.find((s) => s.key === row.status);
  return {
    current: current ? toChoice(current) : { key: row.status, label: row.status, tone: "gray" },
    choices: statuses.filter((s) => row.allowedStatuses.includes(s.key)).map(toChoice),
  };
}

export function BlockedNote({ row }: { row: TaskRow }) {
  if (!row.blocked) return null;
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-danger">
      <Ban className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{row.blockerNote || "Blocked"}</span>
    </span>
  );
}
