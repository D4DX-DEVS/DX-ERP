import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { LeadStageMenu, type StageOption } from "./lead-stage-menu";

export interface LeadCardData {
  id: string;
  title: string;
  company: string;
  value: string | null;
  ownerName?: string;
  ownerPhoto?: string;
  followUp?: { label: string; overdue: boolean };
  age: string;
  source?: string;
  stage: string;
  status: "open" | "won" | "lost";
  lostReason?: string;
}

/** Kanban card: title, company, expected value, owner, next follow-up (overdue in red) and age. */
export function LeadCard({ lead, stages, canManage, canCreateProposal }: { lead: LeadCardData; stages: StageOption[]; canManage: boolean; canCreateProposal: boolean }) {
  return (
    <article className="relative flex flex-col gap-2 rounded-xl border border-line bg-white p-3 transition-colors hover:border-brand-200">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={`/crm/leads/${lead.id}`} className="block truncate text-sm font-semibold text-ink after:absolute after:inset-0 after:rounded-xl hover:text-brand-600">
            {lead.title}
          </Link>
          <p className="truncate text-xs text-muted">{lead.company}</p>
        </div>
        {canManage && lead.status !== "won" && (
          <div className="relative z-10 -mt-1 -mr-1">
            <LeadStageMenu leadId={lead.id} status={lead.status} stage={lead.stage} stages={stages} canCreateProposal={canCreateProposal} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[15px] font-semibold text-ink tabular">{lead.value ?? "—"}</span>
        {lead.ownerName && (
          <span title={lead.ownerName}>
            <Avatar name={lead.ownerName} src={lead.ownerPhoto} size="xs" />
            <span className="sr-only">Owner {lead.ownerName}</span>
          </span>
        )}
      </div>
      {lead.status === "lost" && lead.lostReason && <Tag tone="red" className="self-start">{lead.lostReason}</Tag>}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate text-muted">
          {lead.source ? `${lead.source} · ` : ""}
          {lead.age}
        </span>
        {lead.followUp && <span className={cn("shrink-0 font-semibold", lead.followUp.overdue ? "text-danger" : "text-ink-2")}>{lead.followUp.label}</span>}
      </div>
    </article>
  );
}
