import { eq } from "drizzle-orm";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Invoice } from "@/lib/models";
import { PageBody, PageHeader } from "@/components/ui/page";
import { idParam, type SearchParams } from "@/lib/query";
import { addDays, todayKey } from "@/lib/time";
import { loadInvoiceFormOptions } from "../form-data";
import { InvoiceForm, type InvoiceFormInitial } from "../invoice-form";
import { CUSTOM_TERM, taxPartsOf } from "../totals";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("invoices.manage");
  const sp = await searchParams;
  const cloneId = idParam(sp, "clone");
  const [options, [source]] = await Promise.all([
    loadInvoiceFormOptions(user),
    cloneId
      ? db()
          .select({
            invoiceNo: Invoice.invoiceNo,
            draftNo: Invoice.draftNo,
            client: Invoice.client,
            project: Invoice.project,
            contract: Invoice.contract,
            paymentTermDays: Invoice.paymentTermDays,
            items: Invoice.items,
            discount: Invoice.discount,
            placeOfSupply: Invoice.placeOfSupply,
            notes: Invoice.notes,
            terms: Invoice.terms,
          })
          .from(Invoice)
          .where(eq(Invoice._id, cloneId))
          .limit(1)
      : [],
  ]);
  const today = todayKey();
  // A clone is offered only when its client is one the user may bill (restricted clients stay hidden).
  const clone = source && options.clients.some((c) => c.id === source.client) ? source : undefined;

  let initial: InvoiceFormInitial;
  if (clone) {
    // Same client, lines, notes and terms dated today; the milestone stays with the original invoice.
    const term = options.paymentTerms.find((t) => t.days === clone.paymentTermDays);
    const project = clone.project ? options.projects.find((p) => p.id === clone.project) : undefined;
    initial = {
      client: clone.client,
      project: project?.id ?? "",
      contract: clone.contract && options.contracts?.some((c) => c.id === clone.contract) ? clone.contract : "",
      milestone: "",
      issueDate: today,
      paymentTerm: term ? String(term.days) : CUSTOM_TERM,
      dueDate: addDays(today, clone.paymentTermDays),
      discount: clone.discount ? String(clone.discount) : "",
      placeOfSupply: clone.placeOfSupply ?? "",
      notes: clone.notes ?? "",
      terms: clone.terms ?? "",
      items: clone.items.map((i) => ({ description: i.description, quantity: String(i.quantity), rate: String(i.rate), taxes: taxPartsOf(i) })),
    };
  } else {
    // Optional prefill from a project / milestone link: /invoices/new?project=…&milestone=…
    const projectId = idParam(sp, "project");
    const project = options.projects.find((p) => p.id === projectId);
    const milestone = project?.milestones.find((m) => m.id === idParam(sp, "milestone"));
    const clientId = project?.client ?? idParam(sp, "client") ?? "";
    // Sales within the state: CGST + SGST.
    const defaultTaxes = options.taxes.filter((t) => ["CGST", "SGST"].includes(t.name.toUpperCase()));
    const net15 = options.paymentTerms.find((t) => t.days === 15) ?? options.paymentTerms[0];
    initial = {
      client: options.clients.some((c) => c.id === clientId) ? clientId : "",
      project: project?.id ?? "",
      contract: project?.contract && options.contracts?.some((c) => c.id === project.contract) ? project.contract : "",
      milestone: milestone?.id ?? "",
      issueDate: today,
      paymentTerm: net15 ? String(net15.days) : "custom",
      dueDate: "",
      discount: "",
      placeOfSupply: options.clients.find((c) => c.id === clientId)?.state ?? "",
      notes: options.defaults.notes,
      terms: options.defaults.terms,
      items: milestone
        ? [{ description: milestone.title, quantity: "1", rate: milestone.amount ? String(milestone.amount) : "", taxes: defaultTaxes }]
        : [{ description: "", quantity: "1", rate: "", taxes: defaultTaxes }],
    };
  }

  return (
    <PageBody>
      <PageHeader
        back={clone ? { href: `/invoices/${cloneId}`, label: clone.invoiceNo ?? clone.draftNo } : { href: "/invoices", label: "Invoices" }}
        title={clone ? `Clone ${clone.invoiceNo ?? clone.draftNo}` : "New invoice"}
        description={
          clone
            ? "A new draft with the same client, lines, notes and terms. Change the amounts or dates, save it, then issue it to give it the next invoice number."
            : "Saved as a draft until you issue it."
        }
      />
      <InvoiceForm
        initial={initial}
        clients={options.clients}
        projects={options.projects}
        contracts={options.contracts}
        taxes={options.taxes}
        paymentTerms={options.paymentTerms}
        billing={options.billing}
      />
    </PageBody>
  );
}
