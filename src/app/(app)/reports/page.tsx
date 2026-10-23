import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban, LogOut, Receipt, Users, type LucideIcon } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { canOpenReport, getReport, reportCatalogue } from "@/lib/reports/registry";
import { movementMinutesByDepartment } from "@/lib/reports/movement";
import { DEFAULTS } from "@/lib/reports/shared";
import type { ReportGroup } from "@/lib/reports/types";
import { fmtDate, formatDuration, todayKey } from "@/lib/time";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Reports" };

const GROUP_STYLE: Record<ReportGroup, { icon: LucideIcon; tone: string; blurb: string }> = {
  HR: { icon: Users, tone: "bg-brand-100 text-brand-600", blurb: "People, attendance, leave, payroll and interns" },
  Movement: { icon: LogOut, tone: "bg-tone-orange-bg text-tone-orange", blurb: "Out-Time and In-Time, duration and approvals" },
  Projects: { icon: FolderKanban, tone: "bg-tone-green-bg text-tone-green", blurb: "Delivery, tasks, workload, QA and effort" },
  "CRM & Finance": { icon: Receipt, tone: "bg-tone-purple-bg text-tone-purple", blurb: "Enquiries, proposals, invoices, expenses and assets" },
};

export default async function ReportsPage() {
  const user = await requirePagePermission("reports.view");
  const catalogue = reportCatalogue(user);

  const duration = getReport("movement-duration");
  const showChart = Boolean(duration && canOpenReport(user, duration));
  const canExport = can(user, "reports.export");
  const showPersonal = can(user, "movement.view_personal");
  const from = DEFAULTS.monthStart();
  const to = todayKey();
  const chart = showChart ? await movementMinutesByDepartment(from, to) : null;
  const maxMinutes = Math.max(1, ...(chart?.rows ?? []).map((r) => r.officialMinutes + (showPersonal ? r.personalMinutes : 0)));
  const query = `from=${from}&to=${to}`;

  return (
    <PageBody>
      <PageHeader overline="Operations · you see the reports your role allows" title="Reports" description="Pick a report, set the filters and review the numbers on screen. Exports to Excel, CSV and PDF are audited." />

      {catalogue.length === 0 ? (
        <Card>
          <EmptyState title="No reports available" description="Your role does not include access to any report. Ask an administrator if you need one." />
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className={cn("flex min-w-0 flex-col gap-4", chart ? "lg:col-span-2" : "lg:col-span-3")}>
            {catalogue.map(({ group, reports }) => {
              const style = GROUP_STYLE[group];
              const Icon = style.icon;
              return (
                <Card key={group}>
                  <div className="flex items-center gap-3 px-5 pt-4 pb-3">
                    <span className={cn("flex size-[30px] items-center justify-center rounded-[9px]", style.tone)}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display text-base font-semibold text-ink">{group === "HR" ? "People & HR" : group}</h2>
                      <p className="text-xs text-muted">{style.blurb}</p>
                    </div>
                  </div>
                  <CardBody>
                    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {reports.map((r) => (
                        <li key={r.key}>
                          <Link href={`/reports/${r.key}`} className="flex h-full flex-col gap-0.5 rounded-[10px] border border-line p-3 transition-colors hover:border-brand-400 hover:bg-brand-50">
                            <span className="text-[13px] font-semibold text-ink">{r.title}</span>
                            <span className="text-xs leading-snug text-muted">{r.description}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              );
            })}
          </div>

          {chart && (
            <Card className="min-w-0">
              <CardBody className="flex flex-col gap-4 pt-5">
                <div>
                  <div className="text-xs text-muted">Movement</div>
                  <h2 className="font-display text-lg font-semibold text-ink">Time outside office · by department</h2>
                </div>
                <div className="flex gap-4 text-xs text-ink-2">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-chart-1" />
                    Official
                  </span>
                  {showPersonal && (
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-[3px] bg-chart-2" />
                      Personal
                    </span>
                  )}
                </div>
                {chart.rows.length === 0 ? (
                  <p className="text-[13px] text-muted">No movements recorded this month.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {chart.rows.slice(0, 8).map((r) => {
                      const personal = showPersonal ? r.personalMinutes : 0;
                      return (
                        <li key={r.department} className="flex flex-col gap-1">
                          <div className="flex justify-between gap-2 text-xs">
                            <span className="truncate text-ink-2">{r.department}</span>
                            <strong className="tabular">{formatDuration(r.officialMinutes + personal)}</strong>
                          </div>
                          <div className="flex h-3 gap-0.5">
                            <span title={`Official ${formatDuration(r.officialMinutes)}`} className="rounded-l bg-chart-1" style={{ width: `${(r.officialMinutes / maxMinutes) * 100}%` }} />
                            {personal > 0 && <span title={`Personal ${formatDuration(personal)}`} className="rounded-r bg-chart-2" style={{ width: `${(personal / maxMinutes) * 100}%` }} />}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="border-t border-line-soft pt-3 text-xs text-muted">
                  {fmtDate(from, "d MMM")} – {fmtDate(to, "d MMM")} · {chart.movements} movements · {chart.overdue} late returns
                  {showPersonal ? "" : " · personal time is visible only to holders of the personal-movement permission"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/reports/movement-duration?${query}`} className={buttonClass("secondary", "sm")}>
                    Open report
                  </Link>
                  {canExport ? (
                    <a href={`/api/reports/movement-duration?format=xlsx&${query}`} className={buttonClass("secondary", "sm")}>
                      Excel
                    </a>
                  ) : (
                    <span />
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </PageBody>
  );
}
