"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Returns a function that updates URL search params (resetting pagination). */
export function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = (updates: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!opts.keepPage) next.delete("page");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { set, params, pending };
}

/** URL params that switch views or pages rather than filter (not counted as active filters). */
const NON_FILTER_PARAMS = new Set(["page", "view", "tab", "scope", "section", "date", "month", "week"]);

/**
 * Row of filter controls. From `md` up it is an inline row; on phones the filters are hidden behind a
 * "Filters" button (with the number of active filters) so the content comes first.
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const active = [...params.entries()].filter(([k, v]) => v && !NON_FILTER_PARAMS.has(k)).length;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex h-9 items-center gap-1.5 self-start rounded-[10px] border px-3 text-[13px] font-semibold md:hidden",
          open || active ? "border-brand-200 bg-brand-50 text-brand-700" : "border-line-strong bg-white text-ink-2",
        )}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        Filters
        {active > 0 && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] text-white tabular">{active}</span>}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div className={cn("flex-col gap-2 max-md:*:w-full md:flex md:flex-row md:flex-wrap md:items-center", open ? "flex" : "hidden")}>{children}</div>
    </div>
  );
}

export function SearchInput({ param = "q", placeholder = "Search…", className }: { param?: string; placeholder?: string; className?: string }) {
  const { set, params, pending } = useSetParams();
  const current = params.get(param) ?? "";
  const [value, setValue] = useState(current);
  const [synced, setSynced] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in sync when the URL changes elsewhere (e.g. "Clear filters").
  if (synced !== current) {
    setSynced(current);
    setValue(current);
  }

  return (
    <label className={cn("flex h-10 w-full items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-muted focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100 md:w-72", className)}>
      {pending ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Search className="size-4 shrink-0" />}
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-subtle sm:text-sm"
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => set({ [param]: v.trim() || null }), 350);
        }}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => { setValue(""); set({ [param]: null }); }} className="text-subtle hover:text-ink">
          <X className="size-4" />
        </button>
      )}
    </label>
  );
}

export function SelectFilter({
  param,
  options,
  allLabel = "All",
  label,
  className,
}: {
  param: string;
  options: { value: string; label: string }[];
  allLabel?: string;
  label?: string;
  className?: string;
}) {
  const { set, params } = useSetParams();
  return (
    <select
      aria-label={label ?? allLabel}
      value={params.get(param) ?? ""}
      onChange={(e) => set({ [param]: e.target.value || null })}
      className={cn(
        "h-10 max-w-full appearance-none rounded-[10px] border border-line-strong bg-white bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235E6583%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-[right_0.6rem_center] bg-no-repeat pr-8 pl-3 text-base text-ink focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 focus:outline-none sm:text-sm",
        className,
      )}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateFilter({ param, label, type = "date", className }: { param: string; label: string; type?: "date" | "month"; className?: string }) {
  const { set, params } = useSetParams();
  return (
    <label className={cn("flex h-10 items-center justify-between gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] text-muted", className)}>
      <span className="whitespace-nowrap">{label}</span>
      <input
        type={type}
        value={params.get(param) ?? ""}
        onChange={(e) => set({ [param]: e.target.value || null })}
        className="bg-transparent text-base text-ink outline-none sm:text-sm"
      />
    </label>
  );
}

/** Pill filters (design: "Active 9 · In progress 4 …"). */
export function ChipFilters({ param, options, allLabel }: { param: string; options: { value: string; label: string; count?: number }[]; allLabel?: string }) {
  const { set, params } = useSetParams();
  const active = params.get(param) ?? "";
  const all = allLabel ? [{ value: "", label: allLabel }, ...options] : options;
  return (
    <div className="flex flex-wrap gap-1.5 sm:gap-2" role="group">
      {all.map((o) => {
        const on = active === o.value;
        return (
          <button
            key={`opt:${o.value}`}
            type="button"
            aria-pressed={on}
            onClick={() => set({ [param]: o.value || null })}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs whitespace-nowrap transition-colors sm:h-8 sm:px-3 sm:text-[13px]",
              on ? "bg-brand-600 font-semibold text-white" : "border border-line-strong bg-white font-medium text-ink-2 hover:bg-field",
            )}
          >
            {o.label}
            {"count" in o && o.count !== undefined && <span className="opacity-80 tabular">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ClearFilters({ keep = [] }: { keep?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kept = new URLSearchParams();
  for (const k of keep) {
    const v = params.get(k);
    if (v) kept.set(k, v);
  }
  const hasFilters = [...params.keys()].some((k) => !keep.includes(k) && k !== "page");
  if (!hasFilters) return null;
  return (
    <button type="button" onClick={() => router.replace(kept.toString() ? `${pathname}?${kept}` : pathname)} className="flex h-10 items-center gap-1 px-2 text-[13px] font-semibold text-brand-600 hover:text-brand-800">
      <X className="size-4" /> Clear
    </button>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const href = (p: number) => {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const btn = "flex size-8 items-center justify-center rounded-lg border border-line text-ink-2";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-3 text-[13px] text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      {pages > 1 && (
        <span className="flex items-center gap-1.5">
          {page > 1 ? (
            <Link href={href(page - 1)} className={cn(btn, "hover:bg-field")} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <span className={cn(btn, "opacity-40")} aria-hidden>
              <ChevronLeft className="size-4" />
            </span>
          )}
          <span className="px-2 tabular">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className={cn(btn, "hover:bg-field")} aria-label="Next page">
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span className={cn(btn, "opacity-40")} aria-hidden>
              <ChevronRight className="size-4" />
            </span>
          )}
        </span>
      )}
    </div>
  );
}
