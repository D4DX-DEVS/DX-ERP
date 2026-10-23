import { forbidden } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { peopleOptions } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { STATUS } from "@/lib/status";
import { PageBody, PageHeader } from "@/components/ui/page";
import { pageClient } from "../../../_lib/access";
import { ClientForm } from "../../client-form";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission("crm.view");
  if (!can(user, "crm.manage")) forbidden();
  const c = await pageClient(user, id);
  const [settings, people] = await Promise.all([getSettings(), peopleOptions()]);
  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: `/crm/clients/${id}`, label: c.clientNo }} title="Edit client" description={c.name} />
      <ClientForm
        mode="edit"
        canSetConfidential={can(user, "crm.confidential")}
        people={people}
        sources={settings.leadSources}
        statuses={Object.entries(STATUS.client).map(([value, [label]]) => ({ value, label }))}
        initial={{
          id,
          name: c.name,
          type: c.type,
          contactPerson: c.contactPerson ?? "",
          contactDesignation: c.contactDesignation ?? "",
          email: c.email ?? "",
          phone: c.phone ?? "",
          altPhone: c.altPhone ?? "",
          website: c.website ?? "",
          industry: c.industry ?? "",
          gstin: c.gstin ?? "",
          addressLine1: c.address?.line1 ?? "",
          addressLine2: c.address?.line2 ?? "",
          city: c.address?.city ?? "",
          state: c.address?.state ?? "",
          postalCode: c.address?.postalCode ?? "",
          country: c.address?.country ?? "",
          leadSource: c.leadSource ?? "",
          owner: c.owner?.toString() ?? "",
          status: c.status,
          confidential: c.confidential,
          notes: c.notes ?? "",
        }}
      />
    </PageBody>
  );
}
