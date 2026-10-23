import { requirePagePermission } from "@/lib/auth/session";
import { PageBody, PageHeader } from "@/components/ui/page";
import { idParam, type SearchParams } from "@/lib/query";
import { todayKey } from "@/lib/time";
import { loadInvoiceFormOptions } from "../form-data";
import { InvoiceForm, type InvoiceFormInitial } from "../invoice-form";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("invoices.manage");
  const sp = await searchParams;
  const options = await loadInvoiceFormOptions(user);

  // Optional prefill from a project / milestone link: /invoices/new?project=…&milestone=…
  const projectId = idParam(sp, "project");
  const project = options.projects.find((p) => p.id === projectId);
  const milestone = project?.milestones.find((m) => m.id === idParam(sp, "milestone"));
  const clientId = project?.client ?? idParam(sp, "client") ?? "";
  const defaultTax = String(options.taxes.find((t) => t.rate > 0)?.rate ?? 0);
  const net15 = options.paymentTerms.find((t) => t.days === 15) ?? options.paymentTerms[0];

  const initial: InvoiceFormInitial = {
    client: options.clients.some((c) => c.id === clientId) ? clientId : "",
    project: project?.id ?? "",
    contract: project?.contract && options.contracts?.some((c) => c.id === project.contract) ? project.contract : "",
    milestone: milestone?.id ?? "",
    issueDate: todayKey(),
    paymentTerm: net15 ? String(net15.days) : "custom",
    dueDate: "",
    discount: "",
    placeOfSupply: options.clients.find((c) => c.id === clientId)?.state ?? "",
    notes: options.defaults.notes,
    terms: options.defaults.terms,
    items: milestone
      ? [{ description: milestone.title, quantity: "1", rate: milestone.amount ? String(milestone.amount) : "", taxRate: defaultTax }]
      : [{ description: "", quantity: "1", rate: "", taxRate: defaultTax }],
  };

  return (
    <PageBody>
      <PageHeader back={{ href: "/invoices", label: "Invoices" }} title="New invoice" description="Saved as a draft. The invoice number is assigned when you issue it." />
      <InvoiceForm initial={initial} clients={options.clients} projects={options.projects} contracts={options.contracts} taxes={options.taxes} paymentTerms={options.paymentTerms} />
    </PageBody>
  );
}
