import { Segmented } from "@/components/ui/tabs";
import type { AttendanceAccess } from "../_lib/access";

export type AttendanceTab = "me" | "team" | "corrections" | "summary";

/** Section switcher for the attendance module; entries the viewer cannot open are hidden. */
export function AttendanceTabs({ active, access, pendingCorrections }: { active: AttendanceTab; access: AttendanceAccess; pendingCorrections?: number }) {
  const items: { href: string; label: React.ReactNode; active: boolean }[] = [];
  if (access.staff) items.push({ href: "/attendance", label: "My attendance", active: active === "me" });
  if (access.canViewTeam) items.push({ href: "/attendance/team", label: "Team register", active: active === "team" });
  if (access.canDecide) {
    items.push({
      href: "/attendance/corrections",
      active: active === "corrections",
      label: (
        <span className="flex items-center gap-1.5">
          Corrections
          {pendingCorrections ? <span className="rounded-full bg-tone-amber-bg px-1.5 text-[11px] font-semibold text-tone-amber tabular">{pendingCorrections}</span> : null}
        </span>
      ),
    });
  }
  if (access.canViewTeam) items.push({ href: "/attendance/summary", label: "Monthly summary", active: active === "summary" });
  if (items.length < 2) return null;
  return (
    <Segmented items={items} />
  );
}
