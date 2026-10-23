import { forbidden } from "next/navigation";
import { asc } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { toLocalInput } from "@/lib/time";
import { PageBody, PageHeader } from "@/components/ui/page";
import { clientScope, pageLead } from "../../../_lib/access";
import { openStages } from "../../../_lib/pipeline";
import { LeadForm } from "../../lead-form";

export const metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission("crm.view");
  if (!can(user, "crm.manage")) forbidden();
  const lead = await pageLead(user, id);
  const settings = await getSettings();
  const [clients, people] = await Promise.all([
    db()
      .select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo, contactPerson: Client.contactPerson, email: Client.email, phone: Client.phone })
      .from(Client)
      .where(clientScope(user))
      .orderBy(asc(Client.name))
      .limit(1000),
    peopleOptions(),
  ]);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: `/crm/leads/${id}`, label: lead.leadNo }} title="Edit lead" description={lead.title} />
      <LeadForm
        mode="edit"
        clientLocked={lead.status !== "open" || Boolean(lead.proposal)}
        initial={{
          id,
          title: lead.title,
          client: lead.client ?? "",
          companyName: lead.companyName,
          contactName: lead.contactName ?? "",
          email: lead.email ?? "",
          phone: lead.phone ?? "",
          requirement: lead.requirement ?? "",
          budget: lead.budget?.toString() ?? "",
          expectedValue: lead.expectedValue?.toString() ?? "",
          source: lead.source ?? "",
          assignedTo: lead.assignedTo ?? "",
          stage: lead.stage,
          nextFollowUp: toLocalInput(lead.nextFollowUp),
          expectedCloseDate: lead.expectedCloseDate ?? "",
        }}
        clients={clients.map((c) => ({ id: c._id, name: c.name, clientNo: c.clientNo, contactPerson: c.contactPerson ?? undefined, email: c.email ?? undefined, phone: c.phone ?? undefined }))}
        people={people}
        sources={settings.leadSources}
        stages={openStages(settings.pipelineStages).map((s) => ({ key: s.key, label: s.label }))}
      />
    </PageBody>
  );
}
