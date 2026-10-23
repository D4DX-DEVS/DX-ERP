import "server-only";
import { jsPDF } from "jspdf";
import { autoTable, type UserOptions } from "jspdf-autotable";
import type { AppSettings } from "@/lib/config-defaults";
import { fmtDateTime } from "@/lib/time";
import { LOGO_JPEG, LOGO_SIZE } from "./logo";

/**
 * Branded A4 PDF helpers (jsPDF, millimetres). Built-in Helvetica cannot draw "₹", so amounts
 * in PDFs use `pdfMoney` ("Rs. 18,42,500.00").
 */
export const PDF_COLORS = {
  brand: [31, 60, 179] as [number, number, number],
  navy: [10, 20, 80] as [number, number, number],
  ink: [16, 24, 58] as [number, number, number],
  muted: [94, 101, 131] as [number, number, number],
  line: [226, 230, 240] as [number, number, number],
  field: [247, 248, 252] as [number, number, number],
};

const moneyFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function pdfMoney(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "-";
  return `Rs. ${moneyFmt.format(amount)}`;
}

/** Strips characters Helvetica cannot render (keeps the PDF from showing garbage glyphs). */
export function pdfText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/₹/g, "Rs.")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

export interface DocOptions {
  title: string;
  subtitle?: string;
  company: AppSettings["company"];
  orientation?: "portrait" | "landscape";
  /** Right-aligned meta lines under the title, e.g. ["Invoice INV-2026-27-0001", "Date 21 Oct 2026"]. */
  meta?: string[];
}

export interface BrandedDoc {
  doc: jsPDF;
  /** Y position (mm) where content can start. */
  y: number;
  margin: number;
  width: number;
}

export function createDoc(opts: DocOptions): BrandedDoc {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: opts.orientation ?? "portrait" });
  const margin = 15;
  const width = doc.internal.pageSize.getWidth();
  doc.setProperties({ title: pdfText(opts.title), creator: "D4DX ERP", author: pdfText(opts.company.name) });

  const logoH = 16;
  const logoW = (LOGO_SIZE.width / LOGO_SIZE.height) * logoH;
  doc.addImage(LOGO_JPEG, "JPEG", margin, 12, logoW, logoH);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...PDF_COLORS.ink);
  doc.text(pdfText(opts.company.legalName || opts.company.name), margin + logoW + 4, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.muted);
  const companyLines = [
    opts.company.address,
    [opts.company.email, opts.company.phone].filter(Boolean).join("  |  "),
    [opts.company.website, opts.company.gstin ? `GSTIN ${opts.company.gstin}` : ""].filter(Boolean).join("  |  "),
  ]
    .filter(Boolean)
    .flatMap((l) => doc.splitTextToSize(pdfText(l), 95) as string[]);
  doc.text(companyLines, margin + logoW + 4, 21.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...PDF_COLORS.brand);
  doc.text(pdfText(opts.title), width - margin, 18, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.ink);
  let metaY = 24;
  for (const line of opts.meta ?? []) {
    doc.text(pdfText(line), width - margin, metaY, { align: "right" });
    metaY += 4.5;
  }
  if (opts.subtitle) {
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(pdfText(opts.subtitle), width - margin, metaY, { align: "right" });
    metaY += 4.5;
  }

  const lineY = Math.max(34, metaY + 1, 21.5 + companyLines.length * 3.6 + 2);
  doc.setDrawColor(...PDF_COLORS.line);
  doc.setLineWidth(0.4);
  doc.line(margin, lineY, width - margin, lineY);
  return { doc, y: lineY + 7, margin, width };
}

/** Section heading at y; returns the next y. */
export function heading(b: BrandedDoc, text: string, y: number): number {
  b.doc.setFont("helvetica", "bold");
  b.doc.setFontSize(10.5);
  b.doc.setTextColor(...PDF_COLORS.ink);
  b.doc.text(pdfText(text), b.margin, y);
  return y + 5;
}

/** Wrapped paragraph at y; returns the next y (adds pages as needed). */
export function paragraph(b: BrandedDoc, text: string, y: number, opts: { size?: number; color?: [number, number, number]; width?: number } = {}): number {
  const { doc } = b;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(opts.size ?? 9.5);
  doc.setTextColor(...(opts.color ?? PDF_COLORS.ink));
  const lines = doc.splitTextToSize(pdfText(text), opts.width ?? b.width - b.margin * 2) as string[];
  const lineH = (opts.size ?? 9.5) * 0.45;
  const pageH = doc.internal.pageSize.getHeight();
  let cy = y;
  for (const line of lines) {
    if (cy > pageH - 20) {
      doc.addPage();
      cy = 20;
    }
    doc.text(line, b.margin, cy);
    cy += lineH;
  }
  return cy + 2;
}

/** Two-column label/value block; returns next y. */
export function keyValues(b: BrandedDoc, rows: [string, string][], y: number, x?: number, labelWidth = 32): number {
  const { doc } = b;
  const left = x ?? b.margin;
  let cy = y;
  for (const [k, v] of rows) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(pdfText(k), left, cy);
    doc.setTextColor(...PDF_COLORS.ink);
    const lines = doc.splitTextToSize(pdfText(v || "-"), 60) as string[];
    doc.text(lines, left + labelWidth, cy);
    cy += Math.max(1, lines.length) * 4.3;
  }
  return cy + 1;
}

/** Branded table (autotable); returns the y after the table. */
export function table(b: BrandedDoc, opts: Omit<UserOptions, "theme"> & { startY: number }): number {
  autoTable(b.doc, {
    theme: "grid",
    margin: { left: b.margin, right: b.margin },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, textColor: PDF_COLORS.ink, lineColor: PDF_COLORS.line, lineWidth: 0.2 },
    headStyles: { fillColor: PDF_COLORS.field, textColor: PDF_COLORS.muted, fontStyle: "bold", lineColor: PDF_COLORS.line },
    footStyles: { fillColor: [255, 255, 255], textColor: PDF_COLORS.ink, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [252, 252, 254] },
    ...opts,
    head: opts.head?.map((r) => (r as unknown[]).map((c) => (typeof c === "string" ? pdfText(c) : c))) as UserOptions["head"],
    body: opts.body?.map((r) => (r as unknown[]).map((c) => (typeof c === "string" ? pdfText(c) : c))) as UserOptions["body"],
  });
  return (b.doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? opts.startY;
}

/** Adds "Page x of y" and a footer note to every page. */
export function finalize(b: BrandedDoc, note?: string): void {
  const { doc } = b;
  const pages = doc.getNumberOfPages();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.line(b.margin, h - 14, b.width - b.margin, h - 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(pdfText(note ?? `Generated by D4DX ERP on ${fmtDateTime(new Date())}`), b.margin, h - 9);
    doc.text(`Page ${i} of ${pages}`, b.width - b.margin, h - 9, { align: "right" });
  }
}

export function pdfResponse(doc: jsPDF, filename: string, inline = true): Response {
  const bytes = doc.output("arraybuffer");
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
