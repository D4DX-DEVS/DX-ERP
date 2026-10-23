import { can, requirePagePermission } from "@/lib/auth/session";
import { peopleOptions } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { STATUS } from "@/lib/status";
import { PageBody, PageHeader } from "@/components/ui/page";
import { ClientForm } from "../client-form";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const user = await requirePagePermission("crm.manage");
  const [settings, people] = await Promise.all([getSettings(), peopleOptions()]);
  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: "/crm/clients", label: "Clients" }} title="New client" description="We'll warn you if the email, phone or company name matches an existing client or open lead." />
      <ClientForm
        mode="create"
        canSetConfidential={can(user, "crm.confidential")}
        people={people}
        sources={settings.leadSources}
        statuses={Object.entries(STATUS.client).map(([value, [label]]) => ({ value, label }))}
        initial={{
          name: "",
          type: "company",
          contactPerson: "",
          contactDesignation: "",
          email: "",
          phone: "",
          altPhone: "",
          website: "",
          industry: "",
          gstin: "",
          addressLine1: "",
          addressLine2: "",
          city: "",
          state: "",
          postalCode: "",
          country: "India",
          leadSource: "",
          owner: user.id,
          status: "prospect",
          confidential: false,
          notes: "",
        }}
      />
    </PageBody>
  );
}
