import { can, getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Contract, Invoice, Project } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";
import { fmtDate } from "@/lib/time";
import { createDoc, finalize, heading, paragraph, pdfMoney, pdfResponse, pdfText, PDF_COLORS, table } from "@/lib/pdf/base";
import { rupeesInWords } from "@/lib/payroll/words";
import { computeTotals } from "@/app/(app)/invoices/totals";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";

function addressLines(a?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }): string[] {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2, cityLine, a.country].filter((x): x is string => Boolean(x));
}

/** GET /api/pdf/invoice/<id> — invoice PDF (requires `invoices.view`). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "invoices.view")) return new Response("You don't have access to invoices.", { status: 403 });
  const { id } = await ctx.params;
  if (!isObjectId(id)) return new Response("Not found", { status: 404 });

  await connectDB();
  const inv = await Invoice.findById(id).lean();
  if (!inv) return new Response("Not found", { status: 404 });
  const [settings, client, project, contract] = await Promise.all([
    getSettings(),
    Client.findById(inv.client, { name: 1, address: 1, gstin: 1, email: 1, confidential: 1, owner: 1 }).lean(),
    inv.project ? Project.findById(inv.project, { projectNo: 1, title: 1, milestones: 1 }).lean() : null,
    inv.contract && can(user, "contracts.view") ? Contract.findById(inv.contract, { contractNo: 1 }).lean() : null,
  ]);
  if (client && !canSeeClient(user, client)) return new Response("You don't have access to this client.", { status: 403 });

  const isDraft = inv.status === "draft";
  const label = inv.invoiceNo ?? inv.draftNo;
  const totals = computeTotals(inv.items, inv.discount);
  const b = createDoc({
    title: isDraft ? "DRAFT INVOICE" : settings.company.gstin ? "TAX INVOICE" : "INVOICE",
    company: settings.company,
    meta: [label, `${isDraft ? "Date" : "Issued"} ${fmtDate(inv.issueDate)}`, `Due ${fmtDate(inv.dueDate)}`],
  });
  const { doc } = b;
  const pageH = doc.internal.pageSize.getHeight();
  const rightX = b.width - b.margin;

  // --- bill to / reference ------------------------------------------------------------------------
  const snap = inv.billingSnapshot;
  // Once issued, only the frozen snapshot is used so a printed invoice never changes after the client record is edited.
  const gstin = snap ? snap.gstin : client?.gstin;
  const email = snap ? snap.email : client?.email;
  const billTo = [snap ? snap.name : (client?.name ?? "Client"), ...(snap ? (snap.address ? [snap.address] : []) : addressLines(client?.address)), gstin ? `GSTIN ${gstin}` : "", email ?? ""].filter(Boolean);
  const milestone = project?.milestones.find((m) => m._id.toString() === inv.milestone?.toString());
  const reference = [project ? `Project ${project.projectNo}` : "", contract ? `Contract ${contract.contractNo}` : "", milestone ? `Milestone: ${milestone.title}` : "", inv.placeOfSupply ? `Place of supply: ${inv.placeOfSupply}` : ""].filter(Boolean);

  let y = b.y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("BILL TO", b.margin, y);
  doc.text("REFERENCE", b.margin + 100, y);
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_COLORS.ink);
  let leftY = y + 5;
  billTo.forEach((line, i) => {
    doc.setFont("helvetica", i === 0 ? "bold" : "normal");
    const wrapped = doc.splitTextToSize(pdfText(line), 90) as string[];
    doc.text(wrapped, b.margin, leftY);
    leftY += wrapped.length * 4.4;
  });
  doc.setFont("helvetica", "normal");
  let rightY = y + 5;
  for (const line of reference.length ? reference : ["-"]) {
    const wrapped = doc.splitTextToSize(pdfText(line), b.width - b.margin - (b.margin + 100)) as string[];
    doc.text(wrapped, b.margin + 100, rightY);
    rightY += wrapped.length * 4.4;
  }
  y = Math.max(leftY, rightY) + 4;

  // --- line items ------------------------------------------------------------------------------------
  y = table(b, {
    startY: y,
    head: [["Description", "Qty", "Rate", "Tax", "Amount"]],
    body: inv.items.map((i) => [i.description, String(i.quantity), pdfMoney(i.rate), i.taxRate ? `${i.taxRate}%` : "-", pdfMoney(i.amount)]),
    columnStyles: { 1: { halign: "right", cellWidth: 16 }, 2: { halign: "right", cellWidth: 30 }, 3: { halign: "right", cellWidth: 16 }, 4: { halign: "right", cellWidth: 32 } },
  }) + 6;

  // --- totals ----------------------------------------------------------------------------------------------
  const rows: [string, string, boolean?][] = [["Subtotal", pdfMoney(inv.subtotal)]];
  if (inv.discount > 0) rows.push(["Discount", `-${pdfMoney(inv.discount)}`]);
  for (const t of totals.taxByRate) rows.push([`Tax @ ${t.rate}%`, pdfMoney(t.amount)]);
  rows.push(["Total", pdfMoney(inv.total), true]);
  if (!isDraft && inv.status !== "cancelled") {
    rows.push(["Received", pdfMoney(inv.amountPaid)]);
    if (inv.amountRefunded > 0) rows.push(["Refunded", `-${pdfMoney(inv.amountRefunded)}`]);
    if (inv.adjustments > 0) rows.push(["Adjustments", `-${pdfMoney(inv.adjustments)}`]);
    rows.push(["Balance due", pdfMoney(inv.balance), true]);
  }
  if (y + rows.length * 5.5 + 30 > pageH - 20) {
    doc.addPage();
    y = 20;
  }
  for (const [k, v, bold] of rows) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10.5 : 9.5);
    doc.setTextColor(...(bold ? PDF_COLORS.ink : PDF_COLORS.muted));
    doc.text(k, rightX - 62, y);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text(v, rightX, y, { align: "right" });
    y += bold ? 6.5 : 5.2;
  }
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text(pdfText(rupeesInWords(inv.total)), rightX, y, { align: "right" });
  y += 9;

  // --- bank details, notes, terms ------------------------------------------------------------------------
  if (settings.documents.bankDetails) {
    y = heading(b, "Bank details", y);
    y = paragraph(b, settings.documents.bankDetails, y, { size: 9, color: PDF_COLORS.muted });
  }
  if (inv.notes) {
    y = heading(b, "Notes", y + 2);
    y = paragraph(b, inv.notes, y, { size: 9, color: PDF_COLORS.muted });
  }
  if (inv.terms) {
    y = heading(b, "Terms", y + 2);
    paragraph(b, inv.terms, y, { size: 9, color: PDF_COLORS.muted });
  }

  finalize(b, isDraft ? "Draft - not a valid tax invoice until issued" : "This is a computer-generated invoice");
  return pdfResponse(doc, `${label}.pdf`);
}
