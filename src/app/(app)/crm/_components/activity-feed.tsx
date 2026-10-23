import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, Mail, MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import { Tag } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import type { ActivityType } from "@/lib/models/crm";
import { fmtDateTime } from "@/lib/time";
import { ACTIVITY_LABELS } from "../_lib/constants";
import { isPast } from "../_lib/clock";
import { CompleteFollowUp } from "./complete-follow-up";

export interface FeedItem {
  id: string;
  type: ActivityType;
  subject: string;
  notes?: string;
  at: Date;
  dueAt?: Date;
  done: boolean;
  doneAt?: Date;
  outcome?: string;
  byName?: string;
  assigneeName?: string;
  lead?: { id: string; leadNo: string };
  canComplete: boolean;
}

const ICONS: Record<ActivityType, { icon: ReactNode; cls: string }> = {
  call: { icon: <Phone className="size-4" aria-hidden />, cls: "bg-tone-green-bg text-tone-green" },
  meeting: { icon: <Users className="size-4" aria-hidden />, cls: "bg-tone-purple-bg text-tone-purple" },
  email: { icon: <Mail className="size-4" aria-hidden />, cls: "bg-tone-blue-bg text-tone-blue" },
  whatsapp: { icon: <MessageCircle className="size-4" aria-hidden />, cls: "bg-tone-green-bg text-tone-green" },
  note: { icon: <StickyNote className="size-4" aria-hidden />, cls: "bg-tone-gray-bg text-tone-gray" },
  follow_up: { icon: <CalendarClock className="size-4" aria-hidden />, cls: "bg-tone-amber-bg text-tone-amber" },
};

function Row({ item, showLead }: { item: FeedItem; showLead: boolean }) {
  const meta = ICONS[item.type];
  const pending = item.type === "follow_up" && !item.done;
  const overdue = pending && isPast(item.dueAt);
  return (
    <li className="flex gap-3 border-b border-line-soft py-3 last:border-b-0">
      <span className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-[10px]", meta.cls)}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-ink">
            {ACTIVITY_LABELS[item.type]} · {item.subject}
          </span>
          {pending && <Tag tone={overdue ? "red" : "amber"}>{overdue ? "Overdue" : "Pending"}</Tag>}
          {item.type === "follow_up" && item.done && <Tag tone="green">Done</Tag>}
        </div>
        {item.notes && <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{item.notes}</p>}
        {item.done && item.type === "follow_up" && item.outcome && <p className="mt-0.5 text-[13px] text-ink-2">Outcome: {item.outcome}</p>}
        <p className="mt-1 text-xs text-muted">
          {pending ? `Due ${fmtDateTime(item.dueAt)}${item.assigneeName ? ` · ${item.assigneeName}` : ""}` : `${fmtDateTime(item.done && item.type === "follow_up" ? (item.doneAt ?? item.at) : item.at)}${item.byName ? ` · ${item.byName}` : ""}`}
          {showLead && item.lead && (
            <>
              {" · "}
              <Link href={`/crm/leads/${item.lead.id}`} className="font-medium text-brand-600 hover:text-brand-800">
                {item.lead.leadNo}
              </Link>
            </>
          )}
        </p>
      </div>
      {pending && item.canComplete && (
        <div className="shrink-0 self-start">
          <CompleteFollowUp id={item.id} />
        </div>
      )}
    </li>
  );
}

/** Communication history: pending follow-ups first, then logged activity newest-first. */
export function ActivityFeed({ items, showLead = false, empty = "No activity yet. Log a call, meeting or note above." }: { items: FeedItem[]; showLead?: boolean; empty?: string }) {
  const pending = items.filter((i) => i.type === "follow_up" && !i.done).sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
  const history = items
    .filter((i) => !(i.type === "follow_up" && !i.done))
    .sort((a, b) => (b.done && b.type === "follow_up" ? (b.doneAt ?? b.at) : b.at).getTime() - (a.done && a.type === "follow_up" ? (a.doneAt ?? a.at) : a.at).getTime());
  if (items.length === 0) return <p className="px-5 py-8 text-center text-[13px] text-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-4 px-5 pb-4">
      {pending.length > 0 && (
        <section aria-label="Upcoming follow-ups" className="rounded-xl border border-[#f6dfb2] bg-warning-bg/50 px-4 pt-3 pb-1">
          <h3 className="font-sans text-[13px] font-semibold text-[#6f4000]">Upcoming follow-ups</h3>
          <ul>
            {pending.map((i) => (
              <Row key={i.id} item={i} showLead={showLead} />
            ))}
          </ul>
        </section>
      )}
      {history.length > 0 && (
        <ol>
          {history.map((i) => (
            <Row key={i.id} item={i} showLead={showLead} />
          ))}
        </ol>
      )}
    </div>
  );
}
