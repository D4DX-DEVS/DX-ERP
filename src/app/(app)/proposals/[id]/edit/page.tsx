import { forbidden } from "next/navigation";
import { asc } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { proposalTaxOptions } from "@/lib/config-defaults";
import { statusLabel } from "@/lib/status";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { clientScope } from "@/app/(app)/crm/_lib/access";
import { pageProposal } from "../../_lib/access";
import { ProposalForm } from "../../proposal-form";

export const metadata = { title: "Edit proposal" };

export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission("proposals.view");
  if (!can(user, "proposals.manage")) forbidden();
  const p = await pageProposal(user, id);
  const header = <PageHeader back={{ href: `/proposals/${id}`, label: p.proposalNo }} title={`Edit ${p.kind}`} description={`${p.title} · version ${p.version}`} />;

  if (p.status !== "draft" && p.status !== "negotiation") {
    return (
      <PageBody className="max-w-4xl">
        {header}
        <Card>
          <EmptyState
            title={`This proposal is ${statusLabel("proposal", p.status).toLowerCase()}`}
            description="Only draft or negotiation proposals can be edited. Move a sent proposal to negotiation first, or reopen a rejected one."
            action={<ButtonLink href={`/proposals/${id}`}>Back to proposal</ButtonLink>}
          />
        </Card>
      </PageBody>
    );
  }

  const settings = await getSettings();
  const clients = await db().select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo }).from(Client).where(clientScope(user)).orderBy(asc(Client.name)).limit(1000);
  const taxes = proposalTaxOptions(settings.taxes);
  const defaultTax = taxes.find((t) => t.rate === 18)?.rate ?? taxes[0]?.rate ?? 0;

  return (
    <PageBody className="max-w-5xl">
      {header}
      <ProposalForm
        mode="edit"
        clients={clients.map((c) => ({ id: c._id, name: c.name, clientNo: c.clientNo }))}
        taxes={taxes}
        defaultTaxRate={defaultTax}
        clientLocked={p.status !== "draft" || Boolean(p.lead)}
        editingSent={Boolean(p.sentAt)}
        initial={{
          id,
          kind: p.kind,
          title: p.title,
          client: p.client,
          lead: p.lead ?? "",
          summary: p.summary ?? "",
          scope: p.scope ?? "",
          deliverables: p.deliverables.join("\n"),
          timeline: p.timeline ?? "",
          startDate: p.startDate ?? "",
          endDate: p.endDate ?? "",
          items: p.items.map((i) => ({ description: i.description, quantity: String(i.quantity), rate: String(i.rate), taxRate: String(i.taxRate) })),
          discount: p.discount ? String(p.discount) : "",
          milestones: p.paymentMilestones.map((m) => ({ title: m.title, percent: String(m.percent), dueOn: m.dueOn ?? "" })),
          terms: p.terms ?? "",
          validUntil: p.validUntil ?? "",
        }}
      />
    </PageBody>
  );
}
