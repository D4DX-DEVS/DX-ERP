import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { audit } from "@/lib/audit";
import { Client } from "@/lib/models";
import type { ProposalContent } from "@/lib/models/sales";
import { createDoc, finalize, heading, keyValues, paragraph, pdfMoney, pdfResponse, pdfText, table, PDF_COLORS, type BrandedDoc } from "@/lib/pdf/base";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { lookupProposal } from "@/app/(app)/proposals/_lib/access";
import { contentForVersion } from "@/app/(app)/proposals/_lib/content";

/** Starts a new page when fewer than `needed` mm remain. */
function ensure(b: BrandedDoc, y: number, needed: number): number {
  if (y + needed > b.doc.internal.pageSize.getHeight() - 20) {
    b.doc.addPage();
    return 20;
  }
  return y;
}

function drawTotals(b: BrandedDoc, content: ProposalContent, y: number): number {
  const { doc } = b;
  const labelX = b.width - b.margin - 62;
  const valueX = b.width - b.margin;
  const rows: [string, string, boolean?][] = [["Subtotal", pdfMoney(content.subtotal)]];
  if (content.discount > 0) rows.push(["Discount", `- ${pdfMoney(content.discount)}`]);
  if (content.taxTotal > 0) rows.push(["Tax", pdfMoney(content.taxTotal)]);
  y = ensure(b, y, rows.length * 5.5 + 12);
  doc.setFontSize(9);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(label, labelX, y);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text(value, valueX, y, { align: "right" });
    y += 5.5;
  }
  doc.setDrawColor(...PDF_COLORS.line);
  doc.line(labelX, y - 3.5, valueX, y - 3.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_COLORS.ink);
  doc.text("Total", labelX, y + 1.5);
  doc.text(pdfMoney(content.total), valueX, y + 1.5, { align: "right" });
  return y + 9;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!can(user, "proposals.view")) return new NextResponse("You don't have access to proposals.", { status: 403 });

  const { id } = await ctx.params;
  await connectDB();
  const found = await lookupProposal(user, id);
  if (found.status === "missing") return new NextResponse("Not found", { status: 404 });
  if (found.status === "forbidden") return new NextResponse("You don't have access to this proposal.", { status: 403 });
  const p = found.doc;

  const rev = Number.parseInt(new URL(request.url).searchParams.get("rev") ?? "", 10);
  const { content, version } = contentForVersion(p, Number.isFinite(rev) ? rev : undefined);
  const [settings, client] = await Promise.all([getSettings(), Client.findById(p.client).lean()]);

  const quotation = p.kind === "quotation";
  const b = createDoc({
    title: quotation ? "QUOTATION" : "PROPOSAL",
    company: settings.company,
    meta: [`${p.proposalNo}${version > 1 ? ` (version ${version})` : ""}`, `Date: ${fmtDate(p.sentAt ?? p.createdAt)}`, content.validUntil ? `Valid until: ${fmtDate(content.validUntil)}` : ""].filter(Boolean),
  });
  const { doc } = b;
  let y = b.y;

  // Client block
  y = heading(b, "Prepared for", y);
  const address = client?.address ? [client.address.line1, client.address.line2, [client.address.city, client.address.state, client.address.postalCode].filter(Boolean).join(", "), client.address.country].filter(Boolean).join(", ") : "";
  y = keyValues(
    b,
    [
      ["Client", client?.name ?? ""],
      ["Attention", [client?.contactPerson, client?.contactDesignation].filter(Boolean).join(", ")],
      ["Email", client?.email ?? ""],
      ["Address", address],
      ["GSTIN", client?.gstin ?? ""],
    ].filter(([, v]) => v) as [string, string][],
    y,
    undefined,
    24,
  );

  // Title and summary
  y = ensure(b, y + 3, 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...PDF_COLORS.ink);
  const titleLines = doc.splitTextToSize(pdfText(content.title), b.width - b.margin * 2) as string[];
  doc.text(titleLines, b.margin, y);
  y += titleLines.length * 6 + 1;
  if (content.summary) y = paragraph(b, content.summary, y);

  if (content.scope) {
    y = ensure(b, y + 2, 20);
    y = heading(b, "Scope of work", y);
    y = paragraph(b, content.scope, y);
  }

  if (content.deliverables.length > 0) {
    y = ensure(b, y + 2, 20);
    y = heading(b, "Deliverables", y);
    content.deliverables.forEach((d, i) => {
      y = paragraph(b, `${i + 1}. ${d}`, y);
    });
  }

  if (content.timeline || content.startDate || content.endDate) {
    y = ensure(b, y + 2, 20);
    y = heading(b, "Timeline", y);
    const parts = [content.timeline, content.startDate ? `Start: ${fmtDate(content.startDate)}` : "", content.endDate ? `End: ${fmtDate(content.endDate)}` : ""].filter(Boolean);
    y = paragraph(b, parts.join("   |   "), y);
  }

  // Costing
  y = ensure(b, y + 2, 40);
  y = heading(b, "Costing", y);
  const taxed = content.items.some((i) => i.taxRate > 0);
  y = table(b, {
    startY: y,
    head: [["#", "Description", "Qty", "Rate", ...(taxed ? ["Tax"] : []), "Amount"]],
    body: content.items.map((i, idx) => [String(idx + 1), i.description, String(i.quantity), pdfMoney(i.rate), ...(taxed ? [`${i.taxRate}%`] : []), pdfMoney(i.amount)]),
    columnStyles: taxed ? { 0: { cellWidth: 9 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } } : { 0: { cellWidth: 9 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    headStyles: { fillColor: PDF_COLORS.field, textColor: PDF_COLORS.muted, fontStyle: "bold" },
  });
  y = drawTotals(b, content, y + 6);

  // Payment schedule
  if (content.paymentMilestones.length > 0) {
    y = ensure(b, y + 2, 40);
    y = heading(b, "Payment schedule", y);
    y = table(b, {
      startY: y,
      head: [["#", "Milestone", "Share", "Due", "Amount"]],
      body: content.paymentMilestones.map((m, i) => [String(i + 1), m.title, `${m.percent}%`, m.dueOn ? fmtDate(m.dueOn) : "On agreement", pdfMoney(m.amount)]),
      columnStyles: { 0: { cellWidth: 9 }, 2: { halign: "right" }, 4: { halign: "right" } },
    });
    y += 6;
  }

  if (content.terms) {
    y = ensure(b, y + 2, 24);
    y = heading(b, "Terms & conditions", y);
    y = paragraph(b, content.terms, y, { size: 8.5, color: PDF_COLORS.muted });
  }
  if (content.validUntil) {
    y = ensure(b, y + 2, 12);
    paragraph(b, `This ${quotation ? "quotation" : "proposal"} is valid until ${fmtDate(content.validUntil)}.`, y, { size: 9 });
  }

  finalize(b, `${p.proposalNo} - ${settings.company.name}`);
  await audit(user, { action: "export", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `Downloaded PDF of ${p.proposalNo}${version > 1 ? ` (version ${version})` : ""}` });
  return pdfResponse(doc, `${p.proposalNo}${version > 1 ? `-v${version}` : ""}.pdf`);
}
