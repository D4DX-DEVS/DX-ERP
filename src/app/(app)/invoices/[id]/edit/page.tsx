import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Invoice } from "@/lib/models";
import { PageBody, PageHeader } from "@/components/ui/page";
import { isObjectId } from "@/lib/validation";
import { loadInvoiceFormOptions } from "../../form-data";
import { InvoiceForm, type InvoiceFormInitial } from "../../invoice-form";
import { CUSTOM_TERM, taxPartsOf } from "../../totals";

export const metadata = { title: "Edit invoice" };

const DESCRIPTIONS = {
  draft: "Changes are saved to the draft.",
  issued: "This invoice has been issued. Saving updates it, its PDF and the balance due; recorded payments stay as they are.",
  cancelled: "This invoice is cancelled. Saving updates its details; it stays cancelled.",
};

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("invoices.manage");
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const [inv] = await db().select().from(Invoice).where(eq(Invoice._id, id)).limit(1);
  if (!inv) notFound();
  const options = await loadInvoiceFormOptions(user, id);

  const matching = options.paymentTerms.find((t) => t.days === inv.paymentTermDays);
  const initial: InvoiceFormInitial = {
    id,
    invoiceNo: inv.invoiceNo ?? "",
    client: inv.client,
    project: inv.project ?? "",
    contract: inv.contract ?? "",
    milestone: inv.milestone ?? "",
    issueDate: inv.issueDate,
    paymentTerm: matching ? String(matching.days) : CUSTOM_TERM,
    dueDate: inv.dueDate,
    discount: inv.discount ? String(inv.discount) : "",
    placeOfSupply: inv.placeOfSupply ?? "",
    notes: inv.notes ?? "",
    terms: inv.terms ?? "",
    items: inv.items.map((i) => ({ description: i.description, quantity: String(i.quantity), rate: String(i.rate), taxes: taxPartsOf(i) })),
  };
  const label = inv.invoiceNo ?? inv.draftNo;

  return (
    <PageBody>
      <PageHeader back={{ href: `/invoices/${id}`, label }} title={`Edit ${label}`} description={DESCRIPTIONS[inv.status === "draft" || inv.status === "cancelled" ? inv.status : "issued"]} />
      <InvoiceForm
        initial={initial}
        clients={options.clients}
        projects={options.projects}
        contracts={options.contracts}
        taxes={options.taxes}
        paymentTerms={options.paymentTerms}
        billing={options.billing}
        lastInvoiceNo={options.lastInvoiceNo}
        issued={inv.status !== "draft"}
      />
    </PageBody>
  );
}
