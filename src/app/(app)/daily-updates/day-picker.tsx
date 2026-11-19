"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Link to one day. "My updates" uses `?date=`; the Team tab (`range`) opens a day as a one-day period (`?from=&to=`)
 * so its From / To filters stay in step. Today needs no date: it is the default. `keep` is carried on every link.
 */
function dayHref(day: string, today: string, keep = "", range = false): string {
  const q = new URLSearchParams(keep);
  if (day !== today) {
    if (range) {
      q.set("from", day);
      q.set("to", day);
    } else q.set("date", day);
  }
  const qs = q.toString();
  return qs ? `/daily-updates?${qs}` : "/daily-updates";
}

/**
 * Compact day switcher: previous / next day, and a calendar behind the date label. Future days are off limits.
 * With `period` it only shows the label (a date range) and its calendar, which switches back to a single day.
 */
export function DayPicker({
  date,
  today,
  label,
  prev,
  next,
  period = false,
  keep,
  range,
  className,
}: {
  date: string;
  today: string;
  label: string;
  prev?: string;
  next?: string;
  period?: boolean;
  keep?: string;
  range?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const href = (day: string) => dayHref(day, today, keep, range);
  const arrow = "flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-2 hover:bg-field hover:text-brand-600";
  return (
    <div className={cn("flex h-9 w-max items-center gap-0.5 rounded-[10px] border border-line-strong bg-white px-0.5 shadow-xs", className)}>
      {!period && prev && (
        <Link href={href(prev)} aria-label="Previous day" className={arrow} scroll={false}>
          <ChevronLeft className="size-4" aria-hidden />
        </Link>
      )}
      <label className="relative flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-semibold whitespace-nowrap text-ink hover:bg-field">
        <CalendarDays className="size-4 text-brand-600" aria-hidden />
        {!period && date === today && <span className="rounded-full bg-brand-50 px-1.5 py-px text-[11px] font-semibold text-brand-700">Today</span>}
        <span>{label}</span>
        {/* The native picker sits invisibly over the label: phones open their own date wheel, desktops get showPicker(). */}
        <input
          type="date"
          aria-label="Pick a date"
          max={today}
          value={date}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker();
            } catch {
              // Older browsers open the picker on their own.
            }
          }}
          onChange={(e) => e.target.value && e.target.value <= today && router.push(href(e.target.value), { scroll: false })}
          className="absolute inset-0 size-full cursor-pointer text-base opacity-0"
        />
      </label>
      {!period &&
        (next ? (
          <Link href={href(next)} aria-label="Next day" className={arrow} scroll={false}>
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={`${arrow} pointer-events-none opacity-30`} aria-hidden>
            <ChevronRight className="size-4" />
          </span>
        ))}
    </div>
  );
}
