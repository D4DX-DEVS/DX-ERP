import { cn } from "@/lib/cn";
import { statusLabel, statusTone, TONE_CLASSES } from "@/lib/status";

/** Severity as a coloured dot plus label (QA list and issue detail). */
export function SeverityLabel({ value }: { value: string }) {
  const tone = TONE_CLASSES[statusTone("severity", value)];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", tone.fg)}>
      <span className={cn("size-2 rounded-full", tone.dot)} aria-hidden />
      {statusLabel("severity", value)}
    </span>
  );
}
