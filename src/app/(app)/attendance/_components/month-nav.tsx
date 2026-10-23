import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { addMonths, fmtDate } from "@/lib/time";

/** Previous / next month switcher driven by `?month=yyyy-MM` (server rendered). */
export function MonthNav({
  basePath,
  month,
  maxMonth,
  params = {},
}: {
  basePath: string;
  month: string;
  /** Latest month that can be opened (usually the current month). */
  maxMonth?: string;
  /** Other query params to preserve. */
  params?: Record<string, string | undefined>;
}) {
  const href = (m: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("month", m);
    return `${basePath}?${q.toString()}`;
  };
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const nextDisabled = Boolean(maxMonth && next > maxMonth);
  const btn = "flex size-9 items-center justify-center rounded-lg text-ink-2";
  return (
    <div className="flex h-10 items-center rounded-[10px] border border-line-strong bg-white" role="group" aria-label="Month">
      <Link href={href(prev)} aria-label="Previous month" className={cn(btn, "hover:bg-field")}>
        <ChevronLeft className="size-4" />
      </Link>
      <span className="min-w-28 px-2 text-center text-sm font-semibold text-ink">{fmtDate(`${month}-01`, "MMMM yyyy")}</span>
      {nextDisabled ? (
        <span className={cn(btn, "opacity-40")} aria-hidden>
          <ChevronRight className="size-4" />
        </span>
      ) : (
        <Link href={href(next)} aria-label="Next month" className={cn(btn, "hover:bg-field")}>
          <ChevronRight className="size-4" />
        </Link>
      )}
    </div>
  );
}
