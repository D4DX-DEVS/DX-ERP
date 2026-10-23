import { NextResponse } from "next/server";
import { can, getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { exportResponse, isExportFormat } from "@/lib/export";
import { describeFilters, parseFilters, resolveFilters } from "@/lib/reports/filters";
import { canOpenReport, getReport } from "@/lib/reports/registry";

/** Largest export per format (PDFs are rendered in memory, so they are capped much lower). */
const EXPORT_LIMIT = { csv: 50_000, xlsx: 50_000, pdf: 3_000 } as const;

/** Report export (CSV / Excel / PDF). Requires `reports.export` plus the report's own permissions; audited. */
export async function GET(request: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const report = getReport(key);
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  if (!canOpenReport(user, report) || !can(user, "reports.export")) {
    return NextResponse.json({ error: "You don't have permission to export this report." }, { status: 403 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isExportFormat(format)) return NextResponse.json({ error: "Choose csv, xlsx or pdf." }, { status: 400 });

  try {
    const filters = parseFilters(report, url.searchParams);
    const [result, resolved] = await Promise.all([report.run(filters, user), resolveFilters(report, filters, user)]);
    const limit = EXPORT_LIMIT[format];
    const rows = result.rows.slice(0, limit);
    const truncated = result.rows.length > rows.length;

    await audit(user, {
      action: "export",
      entity: "report",
      entityId: report.key,
      ref: report.key,
      summary: `Exported "${report.title}" as ${format.toUpperCase()} (${rows.length} rows)`,
      changes: Object.entries(filters)
        .filter(([, value]) => value)
        .map(([field, to]) => ({ field, to })),
    });

    const subtitle = [describeFilters(resolved), truncated ? `first ${rows.length} of ${result.rows.length} rows` : ""].filter(Boolean).join(" · ");
    return await exportResponse({
      title: report.title,
      filename: report.key,
      columns: result.columns,
      rows,
      format,
      subtitle: subtitle.slice(0, 160) || undefined,
    });
  } catch (error) {
    console.error(`[reports] export failed for ${key}`, error);
    return NextResponse.json({ error: "The export could not be generated. Please try again." }, { status: 500 });
  }
}
