import { History } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { fmtDate } from "@/lib/time";
import type { LifecycleType } from "@/lib/models";
import type { TabProps } from "./types";

const TONES: Partial<Record<LifecycleType, TimelineItem["tone"]>> = {
  promotion: "success",
  joined: "success",
  resignation: "warning",
  exit: "danger",
  access_change: "default",
};

/** Employment history. Confidential events (salary / stipend revisions) are filtered out on the server. */
export function HistoryTab({ person, access }: TabProps) {
  const adminOnly: LifecycleType[] = ["access_change", "role_change"];
  const events = [...(person.history ?? [])]
    .filter((e) => !e.confidential || access.canConfidential)
    .filter((e) => !adminOnly.includes(e.type) || access.canEdit || access.canManageUsers || access.isSelf)
    .sort((a, b) => b.date.localeCompare(a.date) || new Date(b.at).getTime() - new Date(a.at).getTime());

  const items: TimelineItem[] = events.map((e) => ({
    id: e._id?.toString(),
    title: e.summary,
    meta: `${fmtDate(e.date)}${e.byName ? ` · by ${e.byName}` : ""}`,
    body: [e.from || e.to ? `${e.from ?? "—"} → ${e.to ?? "—"}` : "", access.canSeePersonal ? (e.note ?? "") : ""].filter(Boolean).join("\n") || undefined,
    tone: TONES[e.type] ?? "default",
  }));

  return (
    <Card>
      <CardHeader title="Employment history" subtitle="Every change is also recorded in the audit trail." />
      <CardBody>
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <History className="size-4" /> No history recorded yet.
          </div>
        ) : (
          <Timeline items={items} />
        )}
      </CardBody>
    </Card>
  );
}
