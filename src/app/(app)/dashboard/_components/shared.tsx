import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/ui/chip";
import type { Tone } from "@/lib/config-defaults";
import { dateKey, diffDays, fmtDate, fmtTime } from "@/lib/time";

/** Compact label / value line used by the "at a glance" cards. */
export function GlanceRow({ label, sub, value, last }: { label: ReactNode; sub?: ReactNode; value: ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 pb-3", !last && "border-b border-line-soft")}>
      <div className="min-w-0 text-[13px] text-muted">
        {label}
        {sub && <div className="mt-0.5 text-xs font-semibold text-danger">{sub}</div>}
      </div>
      <div className="shrink-0 font-display text-xl font-semibold text-ink tabular">{value}</div>
    </div>
  );
}

/** Line in a card list: leading icon / dot, title, meta and an optional trailing slot. */
export function ListRow({ href, icon, title, meta, trailing, className }: { href?: string; icon?: ReactNode; title: ReactNode; meta?: ReactNode; trailing?: ReactNode; className?: string }) {
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{title}</span>
        {meta && <span className="block truncate text-xs text-muted">{meta}</span>}
      </span>
      {trailing}
    </>
  );
  const cls = cn("flex items-center gap-3 border-t border-line-soft px-5 py-2.5", href && "hover:bg-[#fafbfe]", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function IconBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const map: Record<Tone, string> = {
    blue: "bg-tone-blue-bg text-tone-blue",
    green: "bg-tone-green-bg text-tone-green",
    amber: "bg-tone-amber-bg text-tone-amber",
    red: "bg-tone-red-bg text-tone-red",
    orange: "bg-tone-orange-bg text-tone-orange",
    gray: "bg-tone-gray-bg text-tone-gray",
    purple: "bg-tone-purple-bg text-tone-purple",
  };
  return <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[9px]", map[tone])}>{children}</span>;
}

export function Count({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  return (
    <Chip tone={tone} size="sm" dot={false}>
      {children}
    </Chip>
  );
}

/** "Today 09:12" / "Mon 19 Oct, 15:10" — time of an instant relative to today. */
export function dayTime(value: Date | undefined, today: string): string {
  if (!value) return "—";
  const day = dateKey(value);
  return day === today ? fmtTime(value) : `${fmtDate(day, "EEE d MMM")}, ${fmtTime(value)}`;
}

/** Due-date label with urgency: overdue (red), today / tomorrow (amber) or the date. */
export function dueLabel(due: string | undefined, today: string): { text: string; tone: "red" | "amber" | "muted" } {
  if (!due) return { text: "No deadline", tone: "muted" };
  const d = diffDays(today, due);
  if (d < 0) return { text: `Overdue ${-d}d`, tone: "red" };
  if (d === 0) return { text: "Due today", tone: "amber" };
  if (d === 1) return { text: "Due tomorrow", tone: "amber" };
  return { text: `Due ${fmtDate(due, "d MMM")}`, tone: "muted" };
}

export const DUE_TONE_CLASS = { red: "text-danger font-semibold", amber: "text-warning font-semibold", muted: "text-muted" } as const;
