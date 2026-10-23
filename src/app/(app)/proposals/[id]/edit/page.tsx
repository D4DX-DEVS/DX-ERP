import { forbidden } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client } from "@/lib/models";
import { getSettings } from "@/lib/settings";
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

  await connectDB();
  const settings = await getSettings();
  const clients = await Client.find(clientScope(user), { name: 1, clientNo: 1 }).sort({ name: 1 }).limit(1000).lean();
  const defaultTax = settings.taxes.find((t) => t.rate === 18)?.rate ?? settings.taxes[0]?.rate ?? 0;

  return (
    <PageBody className="max-w-5xl">
      {header}
      <ProposalForm
        mode="edit"
        clients={clients.map((c) => ({ id: c._id.toString(), name: c.name, clientNo: c.clientNo }))}
        taxes={settings.taxes}
        defaultTaxRate={defaultTax}
        clientLocked={p.status !== "draft" || Boolean(p.lead)}
        editingSent={Boolean(p.sentAt)}
        initial={{
          id,
          kind: p.kind,
          title: p.title,
          client: p.client.toString(),
          lead: p.lead?.toString() ?? "",
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
