import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { SearchSelect } from "./search-select";

const fieldBase =
  "w-full rounded-[10px] border border-line-strong bg-white px-3 text-base text-ink placeholder:text-subtle transition-shadow sm:px-3.5 " +
  "focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-100 " +
  "disabled:cursor-not-allowed disabled:bg-field disabled:text-muted aria-invalid:border-danger aria-invalid:ring-danger-bg sm:text-sm";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(fieldBase, "py-2 leading-relaxed sm:py-2.5", className)} {...props} />;
}

/** Dropdown with a search box; takes the same props and `<option>` children as a native `<select>`. */
export function Select({ className, children, ...props }: Omit<ComponentProps<"select">, "ref">) {
  return (
    <SearchSelect
      className={cn(
        fieldBase,
        "h-10 appearance-none field-chevron pr-9 sm:h-10",
        className,
      )}
      {...props}
    >
      {children}
    </SearchSelect>
  );
}

export function Checkbox({ className, label, ...props }: ComponentProps<"input"> & { label?: React.ReactNode }) {
  const box = <input type="checkbox" className={cn("size-[18px] shrink-0 cursor-pointer rounded accent-brand-600", className)} {...props} />;
  if (!label) return box;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
      {box}
      <span>{label}</span>
    </label>
  );
}

export function Radio({ className, label, ...props }: ComponentProps<"input"> & { label: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2">
      <input type="radio" className={cn("size-4 cursor-pointer accent-brand-600", className)} {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Accessible toggle switch built on a native checkbox (works in plain forms). */
export function Switch({ className, label, description, ...props }: Omit<ComponentProps<"input">, "type"> & { label?: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", className)}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" {...props} />
        <span className="h-6 w-10 rounded-full bg-line-strong transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50" />
        <span className="absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      {(label || description) && (
        <span className="flex flex-col">
          {label && <span className="text-sm font-medium text-ink">{label}</span>}
          {description && <span className="text-[13px] text-muted">{description}</span>}
        </span>
      )}
    </label>
  );
}
