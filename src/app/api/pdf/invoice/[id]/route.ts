import { eq } from "drizzle-orm";
import { can, getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Contract, Invoice, Project } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";
import { fmtDate } from "@/lib/time";
import { createDoc, finalize, heading, paragraph, pdfAmount, pdfMoney, pdfResponse, PDF_COLORS, table } from "@/lib/pdf/base";
import { addressLines, boxPair, ensureSpace, signatureBlock, wordsAndTotals, type BoxRow } from "@/lib/pdf/boxes";
import { rupeesInWords } from "@/lib/payroll/words";
import { billingInfo } from "@/app/(app)/invoices/billing-info";
import { computeTotals } from "@/app/(app)/invoices/totals";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";

/** GET /api/pdf/invoice/<id> — invoice PDF (requires `invoices.view`). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "invoices.view")) return new Response("You don't have access to invoices.", { status: 403 });
  const { id } = await ctx.params;
  if (!isObjectId(id)) return new Response("Not found", { status: 404 });

  const [inv] = await db().select().from(Invoice).where(eq(Invoice._id, id)).limit(1);
  if (!inv) return new Response("Not found", { status: 404 });
  const [settings, [client], [project], [contract]] = await Promise.all([
    getSettings(),
    db()
      .select({
        name: Client.name,
        contactPerson: Client.contactPerson,
        address: Client.address,
        gstin: Client.gstin,
        email: Client.email,
        phone: Client.phone,
        confidential: Client.confidential,
        owner: Client.owner,
      })
      .from(Client)
      .where(eq(Client._id, inv.client))
      .limit(1),
    inv.project ? db().select({ projectNo: Project.projectNo, title: Project.title, milestones: Project.milestones }).from(Project).where(eq(Project._id, inv.project)).limit(1) : [],
    inv.contract && can(user, "contracts.view") ? db().select({ contractNo: Contract.contractNo }).from(Contract).where(eq(Contract._id, inv.contract)).limit(1) : [],
  ]);
  if (client && !canSeeClient(user, client)) return new Response("You don't have access to this client.", { status: 403 });

  const isDraft = inv.status === "draft";
  const label = inv.invoiceNo ?? inv.draftNo;
  const totals = computeTotals(inv.items, inv.discount);
  // GST and bank details are printed only when a line is taxed.
  const taxed = totals.items.some((i) => i.taxParts.length > 0);
  const info = billingInfo(settings);
  const b = createDoc({
    title: isDraft ? "DRAFT INVOICE" : taxed ? "TAX INVOICE" : "INVOICE",
    company: taxed ? settings.company : { ...settings.company, gstin: "" },
    meta: [label],
  });
  const { doc } = b;
  const rightX = b.width - b.margin;

  // --- invoice to / invoice details ---------------------------------------------------------------------
  // Once issued, only the snapshot is used: editing the client record does not change a printed invoice (editing the invoice refreshes it).
  const snap = inv.billingSnapshot;
  const billTo = snap
    ? { name: snap.name, contactPerson: snap.contactPerson, address: snap.address ? [snap.address] : [], phone: snap.phone, email: snap.email, gstin: snap.gstin }
    : {
        name: client?.name ?? "Client",
        contactPerson: client?.contactPerson ?? undefined,
        address: addressLines(client?.address ?? undefined),
        phone: client?.phone ?? undefined,
        email: client?.email ?? undefined,
        gstin: client?.gstin ?? undefined,
      };
  const milestone = project?.milestones.find((m) => m._id === inv.milestone);
  const term = settings.paymentTerms.find((t) => t.days === inv.paymentTermDays)?.label ?? `${inv.paymentTermDays} days`;

  let y = boxPair(
    b,
    b.y,
    {
      title: "INVOICE TO",
      labelW: 14,
      rows: [
        { value: billTo.name, bold: true },
        { value: billTo.contactPerson ? `Attn: ${billTo.contactPerson}` : undefined },
        ...billTo.address.map((value) => ({ value })),
        { label: "Phone", value: billTo.phone },
        { label: "Email", value: billTo.email },
        { label: "GSTIN", value: billTo.gstin },
      ],
    },
    {
      title: "INVOICE DETAILS",
      labelW: 27,
      rows: [
        { label: "Invoice no.", value: label, bold: true },
        { label: "Invoice date", value: fmtDate(inv.issueDate) },
        { label: "Due date", value: fmtDate(inv.dueDate) },
        { label: "Payment term", value: term },
        { label: "Place of supply", value: inv.placeOfSupply ?? undefined },
        { label: "Project", value: project ? `${project.projectNo} - ${project.title}` : undefined },
        { label: "Contract", value: contract?.contractNo },
        { label: "Milestone", value: milestone?.title },
      ],
    },
  );

  // --- line items ------------------------------------------------------------------------------------
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("All amounts in Indian Rupees (Rs.)", rightX, y - 1.5, { align: "right" });
  const stack = (values: string[]) => (values.length ? values.join("\n") : "-");
  y =
    table(b, {
      startY: y,
      head: [["Sl. No.", "Description", "Unit Price", "Qty", "Net Amount", "Tax Rate", "Tax Type", "Tax Amount", "Total Amount"]],
      body: totals.items.map((i, idx) => [
        String(idx + 1),
        i.description,
        pdfAmount(i.rate),
        String(i.quantity),
        pdfAmount(i.amount),
        stack(i.taxParts.map((p) => `${p.rate}%`)),
        stack(i.taxParts.map((p) => p.name)),
        stack(i.taxParts.map((p) => pdfAmount(p.amount))),
        pdfAmount(i.amount + i.tax),
      ]),
      foot: [
        [
          { content: "Total", colSpan: 4, styles: { halign: "right" } },
          pdfAmount(totals.subtotal),
          "",
          "",
          pdfAmount(totals.taxTotal),
          pdfAmount(totals.subtotal + totals.taxTotal),
        ],
      ],
      // These replace the helper's styles, so they repeat its colours.
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.8, valign: "top", textColor: PDF_COLORS.ink, lineColor: PDF_COLORS.line, lineWidth: 0.2 },
      headStyles: { fontSize: 7.5, valign: "middle", halign: "center", fillColor: PDF_COLORS.field, textColor: PDF_COLORS.muted, fontStyle: "bold", lineColor: PDF_COLORS.line },
      columnStyles: {
        0: { halign: "center", cellWidth: 10 },
        2: { halign: "right", cellWidth: 21 },
        3: { halign: "right", cellWidth: 11 },
        4: { halign: "right", cellWidth: 22 },
        5: { halign: "right", cellWidth: 13 },
        6: { halign: "center", cellWidth: 14 },
        7: { halign: "right", cellWidth: 21 },
        8: { halign: "right", cellWidth: 24 },
      },
      showFoot: "lastPage",
    }) + 6;

  // --- amount in words / totals ------------------------------------------------------------------------
  const rows: [string, string, boolean?][] = [["Subtotal", pdfMoney(inv.subtotal)]];
  if (inv.discount > 0) rows.push(["Discount", `-${pdfMoney(inv.discount)}`]);
  for (const t of totals.taxLines) rows.push([t.label, pdfMoney(t.amount)]);
  rows.push(["Grand total", pdfMoney(inv.total), true]);
  if (!isDraft && inv.status !== "cancelled") {
    rows.push(["Received", pdfMoney(inv.amountPaid)]);
    if (inv.amountRefunded > 0) rows.push(["Refunded", `-${pdfMoney(inv.amountRefunded)}`]);
    if (inv.adjustments > 0) rows.push(["Adjustments", `-${pdfMoney(inv.adjustments)}`]);
    rows.push(["Balance due", pdfMoney(inv.balance), true]);
  }
  y = wordsAndTotals(b, y, rupeesInWords(inv.total), rows, inv.discount > 0 ? "Tax is charged on the line value after the discount." : undefined);

  // --- GST and bank details (tax invoices only) ---------------------------------------------------------
  if (taxed) {
    const bankRows: BoxRow[] = [...info.bank.map(([label, value]) => ({ label, value })), { value: info.note }];
    y = boxPair(
      b,
      y,
      info.gst.length ? { title: "GST DETAILS", labelW: 22, rows: info.gst.map(([label, value]) => ({ label, value })) } : null,
      info.bank.length || info.note ? { title: "BANK DETAILS", labelW: 24, rows: bankRows } : null,
    );
  }

  // --- notes, terms ---------------------------------------------------------------------------------------
  if (inv.notes) {
    y = heading(b, "Notes", ensureSpace(b, y, 12));
    y = paragraph(b, inv.notes, y, { size: 8.5, color: PDF_COLORS.muted });
  }
  if (inv.terms) {
    y = heading(b, "Terms & conditions", ensureSpace(b, y + 2, 12));
    y = paragraph(b, inv.terms, y, { size: 8.5, color: PDF_COLORS.muted });
  }

  // --- signature (signed by hand after printing) ------------------------------------------------------------
  signatureBlock(b, y, settings.company.legalName || settings.company.name);

  finalize(b, isDraft ? "Draft - not a valid tax invoice until issued" : "This is a computer-generated invoice");
  return pdfResponse(doc, `${label}.pdf`);
}
