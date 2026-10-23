import { Segmented } from "@/components/ui/tabs";
import type { LeaveAccess } from "../_lib/access";

export type LeaveTab = "me" | "approvals" | "calendar" | "balances";

/** Section switcher for the leave module; entries the viewer cannot open are hidden. */
export function LeaveTabs({ active, access, pending }: { active: LeaveTab; access: LeaveAccess; pending?: number }) {
  const items: { href: string; label: React.ReactNode; active: boolean }[] = [];
  if (access.staff) items.push({ href: "/leave", label: "My leave", active: active === "me" });
  if (access.canOpenApprovals) {
    items.push({
      href: "/leave/approvals",
      active: active === "approvals",
      label: (
        <span className="flex items-center gap-1.5">
          Approvals
          {pending ? <span className="rounded-full bg-tone-amber-bg px-1.5 text-[11px] font-semibold text-tone-amber tabular">{pending}</span> : null}
        </span>
      ),
    });
  }
  items.push({ href: "/leave/calendar", label: "Team calendar", active: active === "calendar" });
  if (access.manage) items.push({ href: "/leave/balances", label: "Balances", active: active === "balances" });
  if (items.length < 2) return null;
  return (
    <Segmented items={items} />
  );
}
