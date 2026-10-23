import type { ProposalContent } from "@/lib/models/sales";
import type { IProposal } from "@/lib/models";

/** Plain snapshot of a proposal's editable content (stored in `revisions` and used for the PDF / read view). */
export function contentOf(p: ProposalContent): ProposalContent {
  return {
    title: p.title,
    summary: p.summary,
    scope: p.scope,
    deliverables: [...p.deliverables],
    timeline: p.timeline,
    startDate: p.startDate,
    endDate: p.endDate,
    items: p.items.map((i) => ({ description: i.description, quantity: i.quantity, rate: i.rate, taxRate: i.taxRate, amount: i.amount })),
    discount: p.discount,
    subtotal: p.subtotal,
    taxTotal: p.taxTotal,
    total: p.total,
    paymentMilestones: p.paymentMilestones.map((m) => ({ title: m.title, percent: m.percent, amount: m.amount, dueOn: m.dueOn })),
    terms: p.terms,
    validUntil: p.validUntil,
  };
}

/** Content for a given revision number: the current version, or a stored snapshot. */
export function contentForVersion(p: IProposal, rev: number | undefined): { content: ProposalContent; version: number; isCurrent: boolean } {
  if (rev && rev !== p.version) {
    const snap = p.revisions.find((r) => r.version === rev);
    if (snap) return { content: snap.snapshot, version: rev, isCurrent: false };
  }
  return { content: contentOf(p), version: p.version, isCurrent: true };
}
