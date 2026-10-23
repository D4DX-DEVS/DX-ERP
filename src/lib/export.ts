import "server-only";
import ExcelJS from "exceljs";
import { getSettings } from "@/lib/settings";
import { createDoc, finalize, pdfMoney, pdfResponse, pdfText, table } from "@/lib/pdf/base";
import { fmtDateTime } from "@/lib/time";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
  /** money → ₹ formatting in xlsx / Rs. in PDF; number → numeric cell */
  type?: "text" | "number" | "money";
  width?: number;
}

export interface ExportInput<T> {
  title: string;
  /** File name without extension. */
  filename: string;
  columns: ExportColumn<T>[];
  rows: T[];
  format: ExportFormat;
  /** Filter summary printed under the title (PDF / XLSX). */
  subtitle?: string;
}

export function isExportFormat(v: string | null | undefined): v is ExportFormat {
  return v === "csv" || v === "xlsx" || v === "pdf";
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection in text (numbers, including negatives, pass through).
  const numeric = typeof v === "number" || /^-?\d+(\.\d+)?$/.test(s);
  if (!numeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a downloadable CSV / Excel / PDF response for tabular data (FRS §8.9, §19). */
export async function exportResponse<T>(input: ExportInput<T>): Promise<Response> {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${input.filename}-${stamp}`.replace(/[^\w.\-]+/g, "_");

  if (input.format === "csv") {
    const lines = [input.columns.map((c) => csvCell(c.header)).join(",")];
    for (const row of input.rows) lines.push(input.columns.map((c) => csvCell(c.value(row))).join(","));
    return new Response("﻿" + lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (input.format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    wb.creator = "D4DX ERP";
    wb.created = new Date();
    const ws = wb.addWorksheet(input.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    ws.addRow([input.title]).font = { bold: true, size: 14, color: { argb: "FF10183A" } };
    ws.addRow([input.subtitle ? `${input.subtitle} · Generated ${fmtDateTime(new Date())}` : `Generated ${fmtDateTime(new Date())}`]).font = { size: 9, color: { argb: "FF5E6583" } };
    ws.addRow([]);
    const header = ws.addRow(input.columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: "FF3D4566" } };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F6FB" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE2E6F0" } } };
    });
    for (const row of input.rows) {
      ws.addRow(
        input.columns.map((c) => {
          const v = c.value(row);
          if ((c.type === "number" || c.type === "money") && v !== null && v !== undefined && v !== "") return Number(v);
          return v ?? "";
        }),
      );
    }
    input.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width ?? Math.min(48, Math.max(10, c.header.length + 4));
      if (c.type === "money") col.numFmt = '"₹"#,##,##0.00';
      if (c.type === "number") col.numFmt = "#,##0.##";
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const settings = await getSettings();
  const b = createDoc({ title: input.title, company: settings.company, orientation: input.columns.length > 6 ? "landscape" : "portrait", meta: [`Generated ${fmtDateTime(new Date())}`, `${input.rows.length} records`], subtitle: input.subtitle });
  table(b, {
    startY: b.y,
    head: [input.columns.map((c) => c.header)],
    body: input.rows.map((row) =>
      input.columns.map((c) => {
        const v = c.value(row);
        if (c.type === "money") return pdfMoney(typeof v === "number" ? v : Number(v ?? 0));
        return pdfText(v ?? "");
      }),
    ),
    columnStyles: Object.fromEntries(input.columns.map((c, i) => [i, c.type === "money" || c.type === "number" ? { halign: "right" as const } : {}])),
  });
  finalize(b);
  return pdfResponse(b.doc, `${base}.pdf`, false);
}
