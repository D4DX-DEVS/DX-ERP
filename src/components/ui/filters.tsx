"use client";

import { Children, isValidElement, useEffect, useRef, useState, useTransition, type ComponentProps, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Popover } from "radix-ui";
import { ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SearchSelect } from "./search-select";

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
const NON_FILTER_PARAMS = new Set(["page", "view", "tab", "scope", "section", "date", "month", "week", "sort"]);

const ROW_GAP = 8; // gap-2
const SEARCH_MIN = 192; // md:min-w-48 on SearchInput

/** Controls mark themselves with `data-filter-kind` (element types are lazy references when passed from a server page). */
type FilterKind = "search" | "pinned" | "filter";

/**
 * Indexes of the filters that do not fit on one row, read from the hidden measuring copy: search (at its minimum
 * width), sort and "Clear" always stay; filters are kept in order while they fit next to a "More filters" button.
 */
function overflowingFilters(row: HTMLElement, measure: HTMLElement): number[] {
  const boxes = [...measure.children] as HTMLElement[];
  const moreWidth = boxes.pop()?.offsetWidth ?? 0;
  const avail = row.clientWidth;
  let used = 0;
  const take = (w: number) => {
    if (w > 0) used += (used > 0 ? ROW_GAP : 0) + w;
  };
  const filters: number[] = [];
  boxes.forEach((box, i) => {
    if (box.offsetWidth === 0) return; // renders nothing (e.g. "Clear" without active filters)
    const kind = ((box.firstElementChild as HTMLElement | null)?.dataset.filterKind ?? "filter") as FilterKind;
    if (kind === "filter") filters.push(i);
    else take(kind === "search" ? SEARCH_MIN : box.offsetWidth);
  });
  const all = filters.reduce((sum, i) => sum + ROW_GAP + boxes[i].offsetWidth, used);
  if (all <= avail) return [];
  take(moreWidth);
  const hidden: number[] = [];
  for (const i of filters) {
    const w = boxes[i].offsetWidth;
    if (hidden.length === 0 && used + ROW_GAP + w <= avail) used += ROW_GAP + w;
    else hidden.push(i);
  }
  return hidden;
}

/**
 * Row of filter controls. From `md` up it is always a single row with no sideways scrolling: filters that do not
 * fit move into a "More filters" popover (search and sort stay in the row). On phones the filters are hidden
 * behind a "Filters" button (with the number of active filters) so the content comes first.
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<number[] | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const active = [...params.entries()].filter(([k, v]) => v && !NON_FILTER_PARAMS.has(k)).length;
  const items = Children.toArray(children).filter(isValidElement);

  useEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const fit = () => {
      const next = window.matchMedia("(min-width: 48rem)").matches ? overflowingFilters(row, measure) : [];
      setHidden((prev) => (prev && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  }, []);

  // Filters that do not fit leave the row; the "More filters" button takes the place of the first of them.
  const moved = new Set(hidden ?? []);
  const more = (
    <MoreFilters key="more-filters" active={items.filter((el, i) => moved.has(i) && isActiveFilter(el, params)).length}>
      {items.filter((_, i) => moved.has(i))}
    </MoreFilters>
  );
  const rowItems = items.flatMap((el, i) => (moved.has(i) ? (i === hidden?.[0] ? [more] : []) : [el]));

  return (
    <div className={cn("relative flex min-w-0 grow flex-col gap-2 md:flex-row md:items-center", className)}>
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
      <div
        ref={rowRef}
        className={cn("flex-col gap-2 max-md:*:w-full md:flex md:min-w-0 md:flex-1 md:flex-row md:items-center", hidden === null && "md:overflow-x-clip", open ? "flex" : "hidden")}
      >
        {rowItems}
      </div>
      {/* Invisible copy at natural widths, used to decide what fits. */}
      <div aria-hidden inert className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden">
        <div ref={measureRef} className="flex w-max items-center gap-2">
          {items.map((el, i) => (
            <div key={i} className="flex shrink-0">
              {el}
            </div>
          ))}
          <MoreFiltersButton active={0} />
        </div>
      </div>
    </div>
  );
}

function isActiveFilter(el: ReactElement, params: URLSearchParams): boolean {
  const param = (el.props as { param?: unknown }).param;
  return typeof param === "string" && Boolean(params.get(param));
}

function MoreFiltersButton({ active, ...props }: { active: number } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-semibold whitespace-nowrap",
        active ? "border-brand-200 bg-brand-50 text-brand-700" : "border-line-strong bg-white text-ink-2 hover:bg-field",
      )}
    >
      <SlidersHorizontal className="size-4" aria-hidden />
      More filters
      {active > 0 && <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] text-white tabular">{active}</span>}
    </button>
  );
}

/** Popover holding the filters that did not fit on the row. */
function MoreFilters({ active, children }: { active: number; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <MoreFiltersButton active={active} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 flex w-72 animate-fade-in flex-col gap-2 rounded-xl border border-line bg-white p-3 shadow-popover *:w-full">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
    <label
      data-filter-kind="search"
      className={cn("flex h-10 w-full items-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-muted focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100 md:w-auto md:max-w-80 md:min-w-48 md:flex-1", className)}
    >
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
    <SearchSelect
      aria-label={label ?? allLabel}
      value={params.get(param) ?? ""}
      onChange={(e) => set({ [param]: e.target.value || null })}
      className={cn(
        "h-10 max-w-full shrink-0 appearance-none rounded-[10px] border border-line-strong bg-white field-chevron pr-8 pl-3 text-base text-ink focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 focus:outline-none sm:text-sm",
        className,
      )}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SearchSelect>
  );
}

/** Sort dropdown bound to `?sort=` (options from `sortParam(...).options`); the first option is the default. */
export function SortSelect({ options, className }: { options: { value: string; label: string }[]; className?: string }) {
  const { set, params } = useSetParams();
  const current = params.get("sort");
  const value = options.some((o) => o.value === current) ? current! : (options[0]?.value ?? "");
  return (
    <label
      data-filter-kind="pinned"
      className={cn("flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-line-strong bg-white pl-3 text-muted focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100", className)}
    >
      <ArrowUpDown className="size-4 shrink-0" aria-hidden />
      <SearchSelect
        aria-label="Sort by"
        value={value}
        onChange={(e) => set({ sort: e.target.value === options[0]?.value ? null : e.target.value })}
        className="h-full min-w-0 flex-1 appearance-none bg-transparent field-chevron pr-8 text-base text-ink outline-none sm:text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SearchSelect>
    </label>
  );
}

export function DateFilter({ param, label, type = "date", className }: { param: string; label: string; type?: "date" | "month"; className?: string }) {
  const { set, params } = useSetParams();
  return (
    <label className={cn("flex h-10 shrink-0 items-center justify-between gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] text-muted", className)}>
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

export function ClearFilters({ keep: keepParams = [] }: { keep?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Sorting is not a filter: it survives "Clear".
  const keep = [...keepParams, "sort"];
  const kept = new URLSearchParams();
  for (const k of keep) {
    const v = params.get(k);
    if (v) kept.set(k, v);
  }
  const hasFilters = [...params.keys()].some((k) => !keep.includes(k) && k !== "page");
  if (!hasFilters) return null;
  return (
    <button type="button" data-filter-kind="pinned" onClick={() => router.replace(kept.toString() ? `${pathname}?${kept}` : pathname)} className="flex h-10 shrink-0 items-center gap-1 px-2 text-[13px] font-semibold text-brand-600 hover:text-brand-800">
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
