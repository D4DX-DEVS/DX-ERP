import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE_CLASSES } from "@/lib/status";
import { fmtDate, formatDuration, weekday } from "@/lib/time";
import { dayChipInfo, type DayKey } from "../_lib/day";
import type { LogDay } from "../_lib/month";
import { LiveDuration } from "./live-duration";

/** Calendar cell appearance per day status (design: Present / Late / Leave / Missing check-out / Holiday-weekend). */
function cellTone(key: DayKey): string {
  if (key === "weekend" || key === "holiday") return "bg-ground text-subtle";
  if (key === "upcoming" || key === "not_checked_in") return "border border-dashed border-line-strong bg-white text-subtle";
  const t = TONE_CLASSES[dayChipInfo(key).tone];
  return cn(t.bg, t.fg);
}

function cellNote(d: LogDay): ReactNode {
  switch (d.cls.key) {
    case "present":
    case "late":
    case "early":
    case "half_day":
      return d.worked ? formatDuration(d.worked) : "";
    case "in_progress":
      if (d.runningAt !== null) return <LiveDuration baseMinutes={d.worked ?? 0} renderedAt={d.runningAt} running />;
      return d.worked ? formatDuration(d.worked) : "In";
    case "on_leave":
    case "half_leave":
      return "Leave";
    case "absent":
      return "Absent";
    case "missing_checkout":
      return "No out";
    case "holiday":
      return "Holiday";
    default:
      return "";
  }
}

const LEGEND = [
  ["Present", "green"],
  ["Late", "amber"],
  ["Leave", "blue"],
  ["Missing check-out", "orange"],
  ["Absent", "red"],
  ["Holiday / weekend", "gray"],
] as const;

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-hidden>
      {LEGEND.map(([label, tone]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[3px]", TONE_CLASSES[tone].dot)} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Month grid (Sunday first, like a wall calendar) of classified days; each cell shows hours worked, leave, holiday or absence. */
export function MonthCalendar({ days, today }: { days: LogDay[]; today: string }) {
  if (days.length === 0) return null;
  const lead = weekday(days[0].date);
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <span key={d} className="py-1 text-center text-xs font-semibold text-muted">
          {d}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={`b${i}`} />
      ))}
      {days.map((d) => (
        <div
          key={d.date}
          title={`${fmtDate(d.date, "EEE d MMM")} · ${dayChipInfo(d.cls.key).label}${d.holidayName ? ` · ${d.holidayName}` : d.leaveLabel ? ` · ${d.leaveLabel}` : ""}`}
          className={cn(
            "flex min-h-12 flex-col justify-between rounded-[10px] p-1 text-[10px] sm:min-h-[58px] sm:px-2 sm:py-1.5 sm:text-[11px]",
            cellTone(d.cls.key),
            d.date === today && "ring-2 ring-brand-500",
          )}
        >
          <span className="text-xs font-semibold">{Number(d.date.slice(8))}</span>
          <span className="truncate">{cellNote(d)}</span>
        </div>
      ))}
    </div>
  );
}
