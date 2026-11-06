import "server-only";
import { pdfText, PDF_COLORS, type BrandedDoc } from "./base";

/**
 * Layout pieces shared by the invoice and receipt PDFs: bordered info boxes, the amount-in-words +
 * totals block and the hand-signed signature block.
 */

export function addressLines(a?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }): string[] {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.line1, a.line2, cityLine, a.country].filter((x): x is string => Boolean(x));
}

/** A line in an info box: an optional muted label column, then the (wrapped) value. */
export interface BoxRow {
  label?: string;
  value: string | undefined;
  bold?: boolean;
}

export interface BoxSpec {
  title: string;
  rows: BoxRow[];
  labelW: number;
}

const LINE_H = 4.2;
const PAD = 3;
const TITLE_H = 6;

/** Wraps a box's rows to its width; returns them with the box height. */
function layoutBox(b: BrandedDoc, rows: BoxRow[], width: number, labelW: number) {
  const { doc } = b;
  doc.setFontSize(8.5);
  const laid = rows
    .filter((r): r is BoxRow & { value: string } => Boolean(r.value))
    .map((r) => {
      doc.setFont("helvetica", r.bold ? "bold" : "normal");
      return { ...r, lines: doc.splitTextToSize(pdfText(r.value), width - PAD * 2 - (r.label ? labelW : 0)) as string[] };
    });
  const count = laid.reduce((n, r) => n + r.lines.length, 0);
  return { laid, height: TITLE_H + 6.5 + Math.max(0, count - 1) * LINE_H + 3 };
}

/** Bordered box with a shaded title band. */
function drawBox(b: BrandedDoc, x: number, y: number, width: number, height: number, title: string, box: ReturnType<typeof layoutBox>, labelW: number) {
  const { doc } = b;
  doc.setDrawColor(...PDF_COLORS.line);
  doc.setLineWidth(0.3);
  doc.setFillColor(...PDF_COLORS.field);
  doc.rect(x, y, width, TITLE_H, "F");
  doc.rect(x, y, width, height);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text(title, x + PAD, y + 4.2);
  let cy = y + TITLE_H + 5;
  doc.setFontSize(8.5);
  for (const r of box.laid) {
    if (r.label) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...PDF_COLORS.muted);
      doc.text(pdfText(r.label), x + PAD, cy);
    }
    doc.setFont("helvetica", r.bold ? "bold" : "normal");
    doc.setTextColor(...PDF_COLORS.ink);
    for (const line of r.lines) {
      doc.text(line, x + PAD + (r.label ? labelW : 0), cy);
      cy += LINE_H;
    }
  }
}

/** Two boxes side by side (either may be left out), equal height; returns the y below them. */
export function boxPair(b: BrandedDoc, y: number, left: BoxSpec | null, right: BoxSpec | null): number {
  const gap = 6;
  const full = b.width - b.margin * 2;
  const both = left && right;
  const w = both ? (full - gap) / 2 : full;
  const boxes = [left, right].filter((x) => x !== null).map((x) => ({ ...x, box: layoutBox(b, x.rows, w, x.labelW) }));
  if (boxes.length === 0) return y;
  const height = Math.max(...boxes.map((x) => x.box.height));
  y = ensureSpace(b, y, height);
  boxes.forEach((x, i) => drawBox(b, b.margin + i * (w + gap), y, w, height, x.title, x.box, x.labelW));
  return y + height + 6;
}

/** Starts a new page when `height` mm do not fit above the footer; returns the y to draw at. */
export function ensureSpace(b: BrandedDoc, y: number, height: number): number {
  if (y + height <= b.doc.internal.pageSize.getHeight() - 20) return y;
  b.doc.addPage();
  return 20;
}

/**
 * "AMOUNT IN WORDS" box on the left, a label/value totals column on the right (bold rows are shaded).
 * `note` is a small italic line printed just above the block. Returns the y below it.
 */
export function wordsAndTotals(b: BrandedDoc, y: number, words: string, rows: [string, string, boolean?][], note?: string): number {
  const { doc } = b;
  const rightX = b.width - b.margin;
  const totalsW = 76;
  const wordsW = b.width - b.margin * 2 - totalsW - 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(pdfText(words.replace(/^./, (c) => c.toUpperCase())), wordsW - PAD * 2) as string[];
  const blockH = Math.max(rows.length * 5.6 + 2, TITLE_H + 5 + lines.length * 4.4 + 2);
  y = ensureSpace(b, y, blockH + (note ? 5 : 0));

  if (note) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.muted);
    doc.text(pdfText(note), b.margin, y - 2);
    y += 3;
  }
  const wordsH = TITLE_H + 5 + lines.length * 4.4;
  doc.setDrawColor(...PDF_COLORS.line);
  doc.setFillColor(...PDF_COLORS.field);
  doc.rect(b.margin, y, wordsW, TITLE_H, "F");
  doc.rect(b.margin, y, wordsW, wordsH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("AMOUNT IN WORDS", b.margin + PAD, y + 4.2);
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.ink);
  lines.forEach((line, i) => doc.text(line, b.margin + PAD, y + TITLE_H + 5 + i * 4.4));

  let ty = y + 4;
  const totalsX = rightX - totalsW;
  for (const [k, v, bold] of rows) {
    if (bold) {
      doc.setFillColor(...PDF_COLORS.field);
      doc.rect(totalsX, ty - 4, totalsW, 6, "F");
    }
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 9.5 : 8.5);
    doc.setTextColor(...(bold ? PDF_COLORS.ink : PDF_COLORS.muted));
    doc.text(pdfText(k), totalsX + 2, ty);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text(v, rightX - 2, ty, { align: "right" });
    ty += bold ? 6.4 : 5.4;
  }
  return Math.max(y + wordsH, ty) + 6;
}

/** "For <company>", a blank line to sign on after printing, and "Authorised Signatory". */
export function signatureBlock(b: BrandedDoc, y: number, companyName: string): void {
  const { doc } = b;
  const rightX = b.width - b.margin;
  y = ensureSpace(b, y + 4, 32);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.ink);
  doc.text(pdfText(`For ${companyName}`), rightX, y + 4, { align: "right" });
  doc.setDrawColor(...PDF_COLORS.muted);
  doc.setLineWidth(0.3);
  doc.line(rightX - 70, y + 24, rightX, y + 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.text("Authorised Signatory", rightX, y + 28.5, { align: "right" });
}
