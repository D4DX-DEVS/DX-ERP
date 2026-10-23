import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Invoice } from "@/lib/models";
import { PageBody, PageHeader } from "@/components/ui/page";
import { isObjectId } from "@/lib/validation";
import { loadInvoiceFormOptions } from "../../form-data";
import { InvoiceForm, type InvoiceFormInitial } from "../../invoice-form";
import { CUSTOM_TERM } from "../../totals";

export const metadata = { title: "Edit draft invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const inv = await Invoice.findById(id).lean();
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/invoices/${id}`);
  const options = await loadInvoiceFormOptions(user, id);

  const matching = options.paymentTerms.find((t) => t.days === inv.paymentTermDays);
  const initial: InvoiceFormInitial = {
    id,
    client: inv.client.toString(),
    project: inv.project?.toString() ?? "",
    contract: inv.contract?.toString() ?? "",
    milestone: inv.milestone?.toString() ?? "",
    issueDate: inv.issueDate,
    paymentTerm: matching ? String(matching.days) : CUSTOM_TERM,
    dueDate: inv.dueDate,
    discount: inv.discount ? String(inv.discount) : "",
    placeOfSupply: inv.placeOfSupply ?? "",
    notes: inv.notes ?? "",
    terms: inv.terms ?? "",
    items: inv.items.map((i) => ({ description: i.description, quantity: String(i.quantity), rate: String(i.rate), taxRate: String(i.taxRate) })),
  };

  return (
    <PageBody>
      <PageHeader back={{ href: `/invoices/${id}`, label: inv.draftNo }} title={`Edit ${inv.draftNo}`} description="Only drafts can be edited. Issued invoices are locked." />
      <InvoiceForm initial={initial} clients={options.clients} projects={options.projects} contracts={options.contracts} taxes={options.taxes} paymentTerms={options.paymentTerms} />
    </PageBody>
  );
}
