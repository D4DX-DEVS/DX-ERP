import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { Download } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { parseFilters, resolveFilters } from "@/lib/reports/filters";
import { canOpenReport, getReport } from "@/lib/reports/registry";
import type { SearchParams } from "@/lib/query";
import { inr, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MiniStat, PageBody, PageHeader } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { FilterForm } from "./filter-form";

/** Rows rendered on screen; exports contain everything (up to the export limit). */
const VISIBLE_ROWS = 500;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: getReport(key)?.title ?? "Report" };
}

function renderCell(value: unknown, type: "text" | "number" | "money" | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (type === "money" && typeof value === "number") return inr(value, !Number.isInteger(value));
  if (type === "number" && typeof value === "number") return num(value);
  return String(value);
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> }) {
  const { key } = await params;
  const user = await requirePagePermission("reports.view");
  const report = getReport(key);
  if (!report) notFound();
  if (!canOpenReport(user, report)) forbidden();

  const filters = parseFilters(report, await searchParams);
  const [result, resolved] = await Promise.all([report.run(filters, user), resolveFilters(report, filters, user)]);

  const canExport = can(user, "reports.export");
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const exportHref = (format: string) => `/api/reports/${report.key}?${new URLSearchParams([["format", format], ...query])}`;
  const visible = result.rows.slice(0, VISIBLE_ROWS);

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title={report.title}
        description={report.description}
        actions={
          canExport ? (
            <>
              {[
                ["xlsx", "Excel"],
                ["csv", "CSV"],
                ["pdf", "PDF"],
              ].map(([format, label]) => (
                <a key={format} href={exportHref(format)} className={buttonClass("secondary", "md")}>
                  <Download className="size-4" aria-hidden />
                  {label}
                </a>
              ))}
            </>
          ) : undefined
        }
      />

      {report.filters.length > 0 && <FilterForm action={`/reports/${report.key}`} filters={resolved} />}

      {result.summary && result.summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {result.summary.map((s) => (
            <MiniStat key={s.label} value={s.value} label={s.label} className="border border-line bg-white" />
          ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
          <h2 className="font-display text-[17px] font-semibold text-ink">Results</h2>
          <span className="text-[13px] text-muted tabular">
            {result.rows.length === 0 ? "No rows" : result.rows.length > VISIBLE_ROWS ? `Showing first ${VISIBLE_ROWS} of ${num(result.rows.length)} rows` : `${num(result.rows.length)} row${result.rows.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <TableWrap>
          <THead>
            {result.columns.map((c, ci) => (
              <Th key={`${ci}-${c.header}`} align={c.type === "number" || c.type === "money" ? "right" : "left"}>
                {c.header}
              </Th>
            ))}
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <EmptyRow colSpan={result.columns.length}>Nothing matches these filters. Try a wider date range.</EmptyRow>
            ) : (
              visible.map((row, i) => (
                <Tr key={i}>
                  {result.columns.map((c, ci) => (
                    <Td key={`${ci}-${c.header}`} align={c.type === "number" || c.type === "money" ? "right" : "left"} className={cn(!c.type || c.type === "text" ? "max-w-[22rem]" : "whitespace-nowrap")}>
                      {renderCell(c.value(row), c.type)}
                    </Td>
                  ))}
                </Tr>
              ))
            )}
          </tbody>
        </TableWrap>
        {(result.note || result.rows.length > VISIBLE_ROWS || !canExport) && (
          <div className="flex flex-col gap-1 border-t border-line-soft px-5 py-3 text-xs text-muted">
            {result.rows.length > VISIBLE_ROWS && <p>The screen shows the first {VISIBLE_ROWS} rows. Export the report to get all {num(result.rows.length)} rows.</p>}
            {result.note && <p>{result.note}</p>}
            {!canExport && <p>Exporting reports needs the “Export reports” permission.</p>}
          </div>
        )}
      </Card>
    </PageBody>
  );
}
