import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { StatusOption, Tone } from "@/lib/config-defaults";
import { optionLabel, optionTone, statusLabel, statusTone, TONE_CLASSES } from "@/lib/status";

export function Chip({ tone = "gray", children, dot = true, className, size = "md" }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string; size?: "sm" | "md" }) {
  const t = TONE_CLASSES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap",
        size === "md" ? "h-6 px-2.5 text-xs" : "h-5 px-2 text-[11px]",
        t.bg,
        t.fg,
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", t.dot)} aria-hidden />}
      {children}
    </span>
  );
}

/** Status chip from a fixed workflow vocabulary (see lib/status.ts). */
export function StatusChip({ domain, value, className, size }: { domain: string; value: string | null | undefined; className?: string; size?: "sm" | "md" }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <Chip tone={statusTone(domain, value)} className={className} size={size}>
      {statusLabel(domain, value)}
    </Chip>
  );
}

/** Status chip for configurable option lists (project / task statuses, pipeline stages …). */
export function OptionChip({ options, value, className }: { options: StatusOption[]; value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted">—</span>;
  return (
    <Chip tone={optionTone(options, value)} className={className}>
      {optionLabel(options, value)}
    </Chip>
  );
}

/** Small rectangular tag (role / person type / "Restricted"). */
export function Tag({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const t = TONE_CLASSES[tone];
  return <span className={cn("inline-flex h-5 items-center rounded-md px-2 text-[11px] font-semibold whitespace-nowrap", t.bg, t.fg, className)}>{children}</span>;
}
