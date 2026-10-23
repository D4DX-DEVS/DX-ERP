import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Underlined tab strip driven by URLs (works in Server Components). Tabs with an `icon` show only the icon
 * on phones (label kept for screen readers) and share the width equally, so long tab lists stay on one row.
 */
export function LinkTabs({ items, className }: { items: { href: string; label: ReactNode; icon?: ReactNode; active?: boolean; count?: number | string }[]; className?: string }) {
  return (
    <nav className={cn("-mb-px flex flex-wrap gap-x-1 border-b border-line", className)} aria-label="Sections">
      {items.map((item) => {
        const countClass = cn("rounded-full font-semibold tabular", item.active ? "bg-brand-100 text-brand-600" : "bg-track text-tone-gray");
        return (
          <Link
            key={item.href}
            href={item.href}
            scroll={false}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:h-11 sm:gap-2 sm:px-3 sm:text-sm",
              item.icon && "relative max-sm:min-w-0 max-sm:flex-1 max-sm:justify-center max-sm:px-1",
              item.active ? "border-brand-600 font-semibold text-brand-600" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {item.icon && (
              <span className="relative sm:hidden" aria-hidden>
                {item.icon}
                {item.count !== undefined && <span className={cn(countClass, "absolute -top-1.5 left-3 px-1 text-[10px] leading-4")}>{item.count}</span>}
              </span>
            )}
            <span className={cn(item.icon && "max-sm:sr-only")}>{item.label}</span>
            {item.count !== undefined && <span className={cn(countClass, "px-1.5 py-0.5 text-[11px]", item.icon && "max-sm:sr-only")}>{item.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Segmented control (design: List / Board / Timeline). */
export function Segmented({ items, className }: { items: { href: string; label: ReactNode; active?: boolean }[]; className?: string }) {
  return (
    <div role="group" className={cn("inline-flex max-w-full flex-wrap rounded-[10px] bg-segment p-[3px]", className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          scroll={false}
          aria-current={item.active ? "true" : undefined}
          className={cn(
            "flex h-8 items-center rounded-lg px-2.5 text-xs whitespace-nowrap sm:h-[34px] sm:px-3 sm:text-[13px]",
            item.active ? "bg-white font-semibold text-ink shadow-segment" : "font-medium text-ink-2 hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
