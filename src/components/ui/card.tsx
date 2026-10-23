import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("min-w-0 rounded-[14px] border border-line bg-white", className)} {...props} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
  href,
  hrefLabel,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  href?: string;
  hrefLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2 px-4 pt-3 pb-2 sm:gap-3 sm:px-5 sm:pt-4 sm:pb-3", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-semibold text-ink sm:text-[17px]">{title}</h2>
        {subtitle && <div className="mt-0.5 text-xs text-muted sm:text-[13px]">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        {action}
        {href && (
          <Link href={href} className="text-[13px] font-semibold text-brand-600 hover:text-brand-800">
            {hrefLabel ?? "View all"} →
          </Link>
        )}
      </div>
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 pb-4 sm:px-5 sm:pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5 sm:px-5 sm:py-3", className)} {...props} />;
}

/** Label / value grid for detail pages. */
export function DetailList({ items, columns = 2, className }: { items: { label: ReactNode; value: ReactNode; full?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3 sm:gap-y-4",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item, i) => (
        <div key={i} className={cn("min-w-0", item.full && "sm:col-span-full")}>
          <dt className="text-[11px] font-medium text-muted sm:text-xs">{item.label}</dt>
          <dd className="mt-0.5 text-[13px] break-words text-ink sm:mt-1 sm:text-sm">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
