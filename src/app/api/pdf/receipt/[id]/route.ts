import { and, asc, eq, inArray } from "drizzle-orm";
import { can, getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Invoice, Payment, Project } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";
import { fmtDate } from "@/lib/time";
import { round2 } from "@/lib/format";
import { createDoc, finalize, paragraph, pdfAmount, pdfMoney, pdfResponse, PDF_COLORS, table } from "@/lib/pdf/base";
import { addressLines, boxPair, signatureBlock, wordsAndTotals } from "@/lib/pdf/boxes";
import { rupeesInWords } from "@/lib/payroll/words";
import { computeTotals } from "@/app/(app)/invoices/totals";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";

/**
 * GET /api/pdf/receipt/<invoice id> — payment receipt for an invoice (requires `invoices.view`):
 * every payment and refund recorded against it, the net amount received and the balance left.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "invoices.view")) return new Response("You don't have access to invoices.", { status: 403 });
  const { id } = await ctx.params;
  if (!isObjectId(id)) return new Response("Not found", { status: 404 });

  const [inv] = await db().select().from(Invoice).where(eq(Invoice._id, id)).limit(1);
  if (!inv) return new Response("Not found", { status: 404 });
  if (inv.status === "draft" || inv.amountPaid <= 0) return new Response("No payment has been received on this invoice yet.", { status: 404 });
  const [settings, [client], [project], payments] = await Promise.all([
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
    inv.project ? db().select({ projectNo: Project.projectNo, title: Project.title }).from(Project).where(eq(Project._id, inv.project)).limit(1) : [],
    db()
      .select()
      .from(Payment)
      .where(and(eq(Payment.invoice, inv._id), inArray(Payment.type, ["payment", "refund"])))
      .orderBy(asc(Payment.date), asc(Payment.createdAt)),
  ]);
  if (client && !canSeeClient(user, client)) return new Response("You don't have access to this client.", { status: 403 });

  const label = inv.invoiceNo ?? inv.draftNo;
  const netReceived = round2(inv.amountPaid - inv.amountRefunded);
  // Same rule as the invoice: the company GSTIN is printed only for taxed invoices.
  const taxed = computeTotals(inv.items, inv.discount).items.some((i) => i.taxParts.length > 0);
  const lastPaid = payments.filter((p) => p.type === "payment").at(-1)?.date;
  const b = createDoc({
    title: "RECEIPT",
    company: taxed ? settings.company : { ...settings.company, gstin: "" },
    meta: [`Against invoice ${label}`],
  });
  const { doc } = b;

  // --- received from / receipt details -------------------------------------------------------------------
  const snap = inv.billingSnapshot;
  const from = snap
    ? { name: snap.name, contactPerson: snap.contactPerson, address: snap.address ? [snap.address] : [], phone: snap.phone, email: snap.email, gstin: snap.gstin }
    : {
        name: client?.name ?? "Client",
        contactPerson: client?.contactPerson ?? undefined,
        address: addressLines(client?.address ?? undefined),
        phone: client?.phone ?? undefined,
        email: client?.email ?? undefined,
        gstin: client?.gstin ?? undefined,
      };

  let y = boxPair(
    b,
    b.y,
    {
      title: "RECEIVED FROM",
      labelW: 14,
      rows: [
        { value: from.name, bold: true },
        { value: from.contactPerson ? `Attn: ${from.contactPerson}` : undefined },
        ...from.address.map((value) => ({ value })),
        { label: "Phone", value: from.phone },
        { label: "Email", value: from.email },
        { label: "GSTIN", value: from.gstin },
      ],
    },
    {
      title: "RECEIPT DETAILS",
      labelW: 27,
      rows: [
        { label: "Receipt date", value: lastPaid ? fmtDate(lastPaid) : undefined, bold: true },
        { label: "Invoice no.", value: label },
        { label: "Invoice date", value: fmtDate(inv.issueDate) },
        { label: "Invoice total", value: pdfMoney(inv.total) },
        { label: "Project", value: project ? `${project.projectNo} - ${project.title}` : undefined },
      ],
    },
  );

  if (netReceived > 0) {
    y = paragraph(b, `Received with thanks from ${from.name} the sum of ${pdfMoney(netReceived)} against invoice ${label} dated ${fmtDate(inv.issueDate)}, as detailed below.`, y, { size: 9 });
    y += 3;
  }

  // --- payments ----------------------------------------------------------------------------------------
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("All amounts in Indian Rupees (Rs.)", b.width - b.margin, y - 1.5, { align: "right" });
  y =
    table(b, {
      startY: y,
      head: [["Sl. No.", "Payment no.", "Date", "Mode", "Reference", { content: "Amount", styles: { halign: "right" } }]],
      body: payments.map((p, idx) => [
        String(idx + 1),
        p.paymentNo,
        fmtDate(p.date),
        p.type === "refund" ? `Refund - ${p.method}` : p.method,
        p.reference || "-",
        p.type === "refund" ? `-${pdfAmount(p.amount)}` : pdfAmount(p.amount),
      ]),
      foot: [[{ content: inv.amountRefunded > 0 ? "Net received" : "Total received", colSpan: 5, styles: { halign: "right" } }, pdfAmount(netReceived)]],
      // These replace the helper's styles, so they repeat its colours.
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2, valign: "top", textColor: PDF_COLORS.ink, lineColor: PDF_COLORS.line, lineWidth: 0.2 },
      headStyles: { fontSize: 7.5, valign: "middle", fillColor: PDF_COLORS.field, textColor: PDF_COLORS.muted, fontStyle: "bold", lineColor: PDF_COLORS.line },
      columnStyles: {
        0: { halign: "center", cellWidth: 14 },
        1: { cellWidth: 30 },
        2: { cellWidth: 26 },
        3: { cellWidth: 34 },
        5: { halign: "right", cellWidth: 30 },
      },
      showFoot: "lastPage",
    }) + 6;

  // --- amount in words / summary ---------------------------------------------------------------------------
  const rows: [string, string, boolean?][] = [["Invoice total", pdfMoney(inv.total)]];
  if (inv.amountRefunded > 0) {
    rows.push(["Received", pdfMoney(inv.amountPaid)]);
    rows.push(["Refunded", `-${pdfMoney(inv.amountRefunded)}`]);
  }
  rows.push([inv.amountRefunded > 0 ? "Net received" : "Amount received", pdfMoney(netReceived), true]);
  if (inv.adjustments > 0) rows.push(["Adjustments", `-${pdfMoney(inv.adjustments)}`]);
  rows.push(["Balance due", pdfMoney(inv.balance), true]);
  y = wordsAndTotals(b, y, rupeesInWords(netReceived), rows);

  signatureBlock(b, y, settings.company.legalName || settings.company.name);

  finalize(b, "This is a computer-generated receipt");
  return pdfResponse(doc, `Receipt-${label}.pdf`);
}
