"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const dayHref = (day: string, today: string) => (day === today ? "/daily-updates" : `/daily-updates?date=${day}`);

/** Compact day switcher: previous / next day, and a calendar behind the date label. Future days are off limits. */
export function DayPicker({ date, today, label, prev, next }: { date: string; today: string; label: string; prev: string; next?: string }) {
  const router = useRouter();
  const arrow = "flex size-8 items-center justify-center rounded-lg text-ink-2 hover:bg-field hover:text-brand-600";
  return (
    <div className="flex h-9 items-center gap-0.5 rounded-[10px] border border-line-strong bg-white px-0.5 shadow-xs">
      <Link href={dayHref(prev, today)} aria-label="Previous day" className={arrow} scroll={false}>
        <ChevronLeft className="size-4" aria-hidden />
      </Link>
      <label className="relative flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-semibold whitespace-nowrap text-ink hover:bg-field">
        <CalendarDays className="size-4 text-brand-600" aria-hidden />
        {date === today && <span className="rounded-full bg-brand-50 px-1.5 py-px text-[11px] font-semibold text-brand-700">Today</span>}
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
          onChange={(e) => e.target.value && e.target.value <= today && router.push(dayHref(e.target.value, today), { scroll: false })}
          className="absolute inset-0 size-full cursor-pointer text-base opacity-0"
        />
      </label>
      {next ? (
        <Link href={dayHref(next, today)} aria-label="Next day" className={arrow} scroll={false}>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={`${arrow} pointer-events-none opacity-30`} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  );
}
