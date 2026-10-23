import { asc } from "drizzle-orm";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { PageBody, PageHeader } from "@/components/ui/page";
import { clientScope } from "../../_lib/access";
import { openStages } from "../../_lib/pipeline";
import { LeadForm } from "../lead-form";

export const metadata = { title: "New lead" };

export default async function NewLeadPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("crm.manage");
  const sp = await searchParams;
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
  const stages = openStages(settings.pipelineStages);
  const prefill = idParam(sp, "client");
  const preset = prefill ? clients.find((c) => c._id === prefill) : undefined;

  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: "/crm", label: "Leads & pipeline" }} title="New lead" description="Capture an enquiry. We'll warn you if it looks like one we already have." />
      <LeadForm
        mode="create"
        initial={{
          title: "",
          client: preset?._id ?? "",
          companyName: "",
          contactName: preset?.contactPerson ?? "",
          email: preset?.email ?? "",
          phone: preset?.phone ?? "",
          requirement: "",
          budget: "",
          expectedValue: "",
          source: "",
          assignedTo: user.id,
          stage: stages[0]?.key ?? "",
          nextFollowUp: "",
          expectedCloseDate: "",
        }}
        clients={clients.map((c) => ({ id: c._id, name: c.name, clientNo: c.clientNo, contactPerson: c.contactPerson ?? undefined, email: c.email ?? undefined, phone: c.phone ?? undefined }))}
        people={people}
        sources={settings.leadSources}
        stages={stages.map((s) => ({ key: s.key, label: s.label }))}
      />
    </PageBody>
  );
}
