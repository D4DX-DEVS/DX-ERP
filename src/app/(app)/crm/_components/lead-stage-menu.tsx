"use client";

import { useState, type ReactNode } from "react";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useServerAction } from "@/components/ui/form";
import { moveLeadStage, reopenLead } from "../actions";
import { MarkLostDialog, MarkWonDialog } from "./lead-dialogs";

export interface StageOption {
  key: string;
  label: string;
  category: "open" | "won" | "lost";
}

/**
 * Stage menu for a lead (kanban card "⋯" and the lead page). Open stages move directly; won / lost go
 * through their own dialogs; a lost lead can be reopened.
 */
export function LeadStageMenu({
  leadId,
  status,
  stage,
  stages,
  canCreateProposal,
  trigger,
}: {
  leadId: string;
  status: "open" | "won" | "lost";
  stage: string;
  stages: StageOption[];
  canCreateProposal: boolean;
  trigger?: ReactNode;
}) {
  const [dialog, setDialog] = useState<"won" | "lost" | null>(null);
  const { run } = useServerAction();
  const firstOpen = stages.find((s) => s.category === "open");
  const hasWon = stages.some((s) => s.category === "won");
  const hasLost = stages.some((s) => s.category === "lost");

  const items: (MenuItem | "separator" | null | false)[] = [];
  if (status === "open") {
    for (const s of stages.filter((x) => x.category === "open" && x.key !== stage)) {
      items.push({ label: `Move to ${s.label}`, onSelect: () => run(() => moveLeadStage(leadId, s.key), { successMessage: `Moved to ${s.label}` }) });
    }
    if (hasWon || hasLost) items.push("separator");
    if (hasWon) items.push({ label: "Mark won…", onSelect: () => setDialog("won") });
    if (hasLost) items.push({ label: "Mark lost…", danger: true, onSelect: () => setDialog("lost") });
  } else if (status === "lost" && firstOpen) {
    items.push({ label: `Reopen in ${firstOpen.label}`, onSelect: () => run(() => reopenLead(leadId, firstOpen.key), { successMessage: "Lead reopened" }) });
  }

  return (
    <>
      <Menu items={items} trigger={trigger} label="Move lead" />
      <MarkWonDialog leadId={leadId} open={dialog === "won"} onOpenChange={(o) => setDialog(o ? "won" : null)} canCreateProposal={canCreateProposal} />
      <MarkLostDialog leadId={leadId} open={dialog === "lost"} onOpenChange={(o) => setDialog(o ? "lost" : null)} />
    </>
  );
}
