import { ShortOnPhone } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import type { AttendanceAccess } from "../_lib/access";

export type AttendanceTab = "me" | "team" | "corrections" | "summary";

/** Section switcher for the attendance module; entries the viewer cannot open are hidden. */
export function AttendanceTabs({ active, access, pendingCorrections }: { active: AttendanceTab; access: AttendanceAccess; pendingCorrections?: number }) {
  const items: { href: string; label: React.ReactNode; active: boolean }[] = [];
  if (access.staff) items.push({ href: "/attendance", label: <ShortOnPhone short="Mine">My attendance</ShortOnPhone>, active: active === "me" });
  if (access.canViewTeam) items.push({ href: "/attendance/team", label: <ShortOnPhone short="Team">Team register</ShortOnPhone>, active: active === "team" });
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
  if (access.canViewTeam) items.push({ href: "/attendance/summary", label: <ShortOnPhone short="Summary">Monthly summary</ShortOnPhone>, active: active === "summary" });
  if (items.length < 2) return null;
  // Phones: short labels, all tabs on one row.
  return <Segmented items={items} className="max-sm:flex max-sm:flex-nowrap max-sm:*:flex-1 max-sm:*:justify-center" />;
}
