import { forbidden, notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client } from "@/lib/models";
import { idParam, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { clientScope, lookupLead } from "@/app/(app)/crm/_lib/access";
import { inDays } from "@/app/(app)/crm/_lib/clock";
import { ProposalForm } from "../proposal-form";

export const metadata = { title: "New proposal" };

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("proposals.manage");
  const sp = await searchParams;
  await connectDB();
  const settings = await getSettings();

  const leadId = idParam(sp, "lead");
  let lead = null;
  if (leadId) {
    const r = await lookupLead(user, leadId);
    if (r.status === "missing") notFound();
    if (r.status === "forbidden") forbidden();
    lead = r.doc;
  }

  const header = <PageHeader back={{ href: lead ? `/crm/leads/${lead._id}` : "/proposals", label: lead ? lead.leadNo : "Proposals" }} title="New proposal" description={lead ? `Prefilled from ${lead.leadNo} · ${lead.companyName}` : undefined} />;

  if (lead?.status === "lost") {
    return (
      <PageBody className="max-w-4xl">
        {header}
        <Card>
          <EmptyState
            title="This lead was marked lost"
            description="Reopen the lead before raising a proposal for it."
            action={<ButtonLink href={`/crm/leads/${lead._id}`}>Open lead</ButtonLink>}
          />
        </Card>
      </PageBody>
    );
  }

  const clients = await Client.find(clientScope(user), { name: 1, clientNo: 1 }).sort({ name: 1 }).limit(1000).lean();
  const prefillClient = idParam(sp, "client");
  const clientId = lead?.client?.toString() ?? (prefillClient && clients.some((c) => c._id.toString() === prefillClient) ? prefillClient : "");
  const defaultTax = settings.taxes.find((t) => t.rate === 18)?.rate ?? settings.taxes[0]?.rate ?? 0;

  return (
    <PageBody className="max-w-5xl">
      {header}
      <ProposalForm
        mode="create"
        clients={clients.map((c) => ({ id: c._id.toString(), name: c.name, clientNo: c.clientNo }))}
        taxes={settings.taxes}
        defaultTaxRate={defaultTax}
        clientLocked={Boolean(lead?.client)}
        leadCompany={lead && !lead.client ? lead.companyName : undefined}
        initial={{
          kind: "proposal",
          title: lead?.title ?? "",
          client: clientId,
          lead: lead?._id.toString() ?? "",
          summary: lead?.requirement ?? "",
          scope: "",
          deliverables: "",
          timeline: "",
          startDate: "",
          endDate: "",
          items: [{ description: lead?.title ?? "", quantity: "1", rate: "", taxRate: String(defaultTax) }],
          discount: "",
          milestones: [],
          terms: settings.documents.proposalTerms,
          validUntil: inDays(30),
        }}
      />
    </PageBody>
  );
}
