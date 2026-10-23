import { Chip } from "@/components/ui/chip";
import { dayChipInfo, type DayClass, type DayKey } from "../_lib/day";

export function DayChip({ day, size }: { day: DayKey; size?: "sm" | "md" }) {
  if (day === "upcoming") return <span className="text-muted">—</span>;
  const { label, tone } = dayChipInfo(day);
  return (
    <Chip tone={tone} size={size}>
      {label}
    </Chip>
  );
}

/** Primary status chip plus small flags (late / early departure). */
export function DayChips({ cls, size }: { cls: DayClass; size?: "sm" | "md" }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <DayChip day={cls.key} size={size} />
      {cls.extras.map((e) => (
        <DayChip key={e} day={e} size="sm" />
      ))}
    </span>
  );
}
