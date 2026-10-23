import type { Tone } from "@/lib/config-defaults";
import { diffDays } from "@/lib/time";

export const ASSET_STATUSES = ["available", "assigned", "in_repair", "damaged", "lost", "retired"] as const;
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

/** Label + timeline tone for each asset history action. */
export const HISTORY_ACTIONS: Record<string, { label: string; tone: "default" | "success" | "danger" | "warning" }> = {
  created: { label: "Added to inventory", tone: "success" },
  edited: { label: "Details edited", tone: "default" },
  issued: { label: "Issued", tone: "default" },
  returned: { label: "Returned", tone: "success" },
  transferred: { label: "Transferred", tone: "default" },
  sent_to_repair: { label: "Sent for repair", tone: "warning" },
  back_from_repair: { label: "Back from repair", tone: "success" },
  damaged: { label: "Marked damaged", tone: "danger" },
  lost: { label: "Marked lost", tone: "danger" },
  retired: { label: "Retired", tone: "danger" },
  restored: { label: "Returned to stock", tone: "success" },
  serviced: { label: "Service recorded", tone: "default" },
};

/** Warranty badge: expired, or ending within 30 days; null when comfortably in date or unknown. */
export function warrantyState(until: string | undefined, today: string): { label: string; tone: Tone } | null {
  if (!until) return null;
  const days = diffDays(today, until);
  if (days < 0) return { label: "Expired", tone: "red" };
  if (days === 0) return { label: "Ends today", tone: "orange" };
  if (days <= 30) return { label: `Ends in ${days} d`, tone: "orange" };
  return null;
}

/** Next-service badge: overdue, or due within 7 days; null otherwise. */
export function serviceState(due: string | undefined, today: string): { label: string; tone: Tone } | null {
  if (!due) return null;
  const days = diffDays(today, due);
  if (days < 0) return { label: "Overdue", tone: "red" };
  if (days === 0) return { label: "Due today", tone: "orange" };
  if (days <= 7) return { label: `Due in ${days} d`, tone: "orange" };
  return null;
}
