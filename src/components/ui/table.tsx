import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Column numbers (1-based) or "last" to keep visible at a screen size; every other column is hidden there. */
export type KeepColumns = (number | "last")[];

const SCREENS = [
  { media: "(max-width: 639.98px)" },
  { media: "(min-width: 640px) and (max-width: 1023.98px)" },
  { media: "(min-width: 1024px) and (max-width: 1279.98px)" },
  { media: "(min-width: 1280px)" },
] as const;

function hideRule(keep: KeepColumns | "auto" | "all"): string | null {
  if (keep === "all") return null;
  // Laptop default: hide the 7th column onwards (but never the last one).
  if (keep === "auto") return ":nth-child(n+7):not(:last-child)";
  return keep.map((k) => (k === "last" ? ":not(:last-child)" : `:not(:nth-child(${k}))`)).join("");
}

/**
 * Table container. Tables never scroll sideways: they fill the card's width, cells wrap, and on smaller
 * screens only the most useful columns stay visible — `phone` (< 640px, default first + last column),
 * `tablet` (640–1023px, default first three + last), `laptop` (1024–1279px, default first six + last) and
 * `desktop` (1280px+, default all). Pick the columns that matter for each table, e.g. `phone={[1, 5, "last"]}`.
 */
export function TableWrap({
  className,
  children,
  phone = [1, "last"],
  tablet = [1, 2, 3, "last"],
  laptop = "auto",
  desktop = "all",
}: {
  className?: string;
  children: ReactNode;
  phone?: KeepColumns;
  tablet?: KeepColumns;
  laptop?: KeepColumns | "auto";
  desktop?: KeepColumns | "all";
}) {
  const rules = [phone, tablet, laptop, desktop].map(hideRule);
  const key = `tw-${hash(rules.join("|"))}`;
  const css = SCREENS.map((s, i) => (rules[i] ? `@media ${s.media}{.${key} tr>${rules[i]}{display:none}}` : "")).join("");
  return (
    // `relative` + clip: absolutely positioned bits (sr-only labels) can't widen the page, and nothing scrolls.
    <div className={cn("relative overflow-x-clip", key, className)}>
      <style href={key} precedence="medium">
        {css}
      </style>
      {/* `truncate` text wraps here: nowrap would fix the column at the text's full width and push the last columns out of view. */}
      <table className="w-full border-collapse text-xs sm:text-[13px] [&_.truncate]:whitespace-normal">{children}</table>
    </div>
  );
}

/** Small stable hash for the generated class name (same column choices share one stylesheet). */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="bg-field text-left text-muted">{children}</tr>
    </thead>
  );
}

export function Th({ className, children, align = "left", ...props }: ComponentProps<"th"> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2.5 py-2 text-[11px] font-semibold first:pl-4 last:pr-4 sm:px-3 sm:py-2.5 sm:text-xs sm:first:pl-5 sm:last:pr-5 xl:whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-t border-line-soft align-middle hover:bg-[#fafbfe]", className)} {...props} />;
}

export function Td({ className, align = "left", ...props }: ComponentProps<"td"> & { align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cn(
        "px-2.5 py-2 break-words text-ink first:pl-4 last:pr-4 sm:px-3 sm:py-3 sm:first:pl-5 sm:last:pr-5",
        align === "right" && "text-right tabular",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyRow({ colSpan, children = "No records found." }: { colSpan: number; children?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-[13px] text-muted sm:px-5 sm:py-12 sm:text-sm">
        {children}
      </td>
    </tr>
  );
}
