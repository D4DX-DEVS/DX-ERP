import Link from "next/link";
import { Download } from "lucide-react";
import type { AppSettings } from "@/lib/config-defaults";
import { inr, plural } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { maskTail } from "@/lib/payroll/calc";
import { periodLabel, periodShort } from "@/lib/payroll/constants";
import { rupeesInWords } from "@/lib/payroll/words";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import type { PayslipPageData } from "./data";

function money(n: number): string {
  return inr(n, true).replace("₹", "");
}

/** Payslip document with the month list and financial-year summary (design: Payslip). */
export function PayslipView({ data, company, footer }: { data: PayslipPageData; company: AppSettings["company"]; footer: string }) {
  const { slip, list, owner, fy } = data;
  const stipend = slip.kind === "stipend";
  const paid = slip.status === "paid";
  const employee: [string, string][] = [
    ["Employee", slip.snapshot.name],
    ["Employee ID", slip.snapshot.employeeId],
    ["Designation", slip.snapshot.designation || "—"],
    ["Department", slip.snapshot.department || "—"],
    ["Paid days", `${slip.payableDays} of ${slip.workingDays}`],
    ["Unpaid leave", String(slip.lopDays)],
    ["PAN", maskTail(slip.snapshot.pan, 5)],
    ["Bank", slip.snapshot.bankAccount ? `${slip.snapshot.bankName ?? "Account"} ${maskTail(slip.snapshot.bankAccount)}` : "—"],
  ];

  return (
    <div className="flex flex-wrap items-start gap-4">
      {list.length > 1 && (
        <nav aria-label="Pay months" className="flex max-h-[28rem] w-full min-w-[180px] flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-line bg-white p-2 sm:w-[200px] sm:flex-none">
          {list.map((m) => (
            <Link
              key={m.id}
              href={`/payslips/${m.id}`}
              aria-current={m.id === slip._id.toString() ? "page" : undefined}
              className={cn("flex items-center justify-between gap-2 rounded-[10px] px-3 py-2.5 text-sm", m.id === slip._id.toString() ? "bg-brand-600 font-semibold text-white" : "font-medium text-ink hover:bg-field")}
            >
              <span>
                {periodShort(m.period)}
                {m.kind === "stipend" && list.some((x) => x.kind === "salary") ? " · stipend" : ""}
              </span>
              <span className="text-xs opacity-85 tabular">{m.status === "paid" || m.status === "approved" || !owner ? inr(m.net) : "—"}</span>
            </Link>
          ))}
        </nav>
      )}

      <article className="flex min-w-0 flex-[999_1_520px] flex-col gap-5 rounded-[14px] border border-line bg-white p-5 shadow-popover sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3.5">
            {company.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo} alt="" className="h-12 w-auto object-contain" />
            )}
            <div className="text-xs leading-relaxed text-ink-2">
              <strong className="text-sm text-ink">{company.legalName || company.name}</strong>
              {company.address && <div className="whitespace-pre-line">{company.address}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-bold tracking-[0.06em] text-brand-600">{stipend ? "STIPEND STATEMENT" : "PAYSLIP"}</div>
            <div className="text-xs text-ink-2">
              {periodLabel(slip.period)}
              {paid && slip.payment?.date ? ` · paid ${fmtDate(slip.payment.date)}` : ""}
            </div>
            <div className="mt-1">
              <StatusChip domain="payslip" value={slip.status} size="sm" />
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl bg-field p-4 sm:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
          {employee.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-muted">{k}</dt>
              <dd className="mt-0.5 truncate text-[13px] font-semibold" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="flex justify-between border-b border-line pb-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
              <span>Earnings</span>
              <span>₹</span>
            </div>
            {slip.earnings.map((l, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-line-soft py-2 text-[13px]">
                <span>{l.name}</span>
                <span className="tabular">{money(l.amount)}</span>
              </div>
            ))}
            {slip.earnings.length === 0 && <div className="border-b border-line-soft py-2 text-[13px] text-muted">No earnings in this period.</div>}
            <div className="flex justify-between py-2.5 text-sm font-bold">
              <span>Gross earnings</span>
              <span className="tabular">{money(slip.gross)}</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between border-b border-line pb-2 text-xs font-semibold tracking-[0.06em] text-muted uppercase">
              <span>Deductions</span>
              <span>₹</span>
            </div>
            {slip.deductions.map((l, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-line-soft py-2 text-[13px]">
                <span>{l.name}</span>
                <span className="tabular">{money(l.amount)}</span>
              </div>
            ))}
            {slip.deductions.length === 0 && <div className="border-b border-line-soft py-2 text-[13px] text-muted">No deductions.</div>}
            <div className="flex justify-between py-2.5 text-sm font-bold">
              <span>Total deductions</span>
              <span className="tabular">{money(slip.totalDeductions)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-navy px-5 py-4 text-white">
          <span>
            <span className="block text-xs text-navy-soft">Net pay</span>
            <span className="block max-w-sm text-xs text-navy-text">{rupeesInWords(slip.net)}</span>
          </span>
          <span className="font-display text-[28px] font-semibold tabular">{inr(slip.net, true)}</span>
        </div>

        {slip.totalDeductions > slip.gross && <Alert tone="warning">Deductions are higher than earnings for this period, so net pay is held at zero.</Alert>}

        <div className="grid gap-2 text-[13px] text-ink-2 sm:grid-cols-2">
          <div>
            <span className="text-muted">Attendance:</span> {slip.payableDays} payable of {slip.workingDays} days · {slip.lopDays} loss of pay · {slip.presentDays} present · {slip.leaveDays} on leave
          </div>
          <div>
            <span className="text-muted">Payment:</span>{" "}
            {paid && slip.payment?.date ? `${fmtDate(slip.payment.date)} · ${slip.payment.method ?? "—"}${slip.payment.reference ? ` · ref ${slip.payment.reference}` : ""}` : "Not paid yet"}
          </div>
        </div>
        {footer && <div className="text-[11px] text-muted">{footer}</div>}
      </article>

      <aside className="flex w-full min-w-[220px] flex-[1_1_240px] flex-col gap-4">
        <Card>
          <CardHeader title="This financial year" subtitle={`FY ${fy.label} · ${plural(fy.count, "payment")} received`} />
          <CardBody className="flex flex-col gap-2.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted">Gross</span>
              <strong className="tabular">{inr(fy.gross)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Deductions</span>
              <strong className="tabular">{inr(fy.deductions)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Net received</span>
              <strong className="tabular">{inr(fy.net)}</strong>
            </div>
          </CardBody>
        </Card>
        {!paid && (
          <div className="rounded-[14px] bg-brand-50 px-[18px] py-4 text-[13px] leading-relaxed text-brand-700">
            {slip.status === "approved" ? "This payslip is approved. Payment is being processed — you will be notified when it is paid." : "This is a draft and may still change."}
          </div>
        )}
      </aside>
    </div>
  );
}

export function PayslipDownload({ id }: { id: string }) {
  return (
    <a href={`/api/pdf/payslip/${id}`} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
      <Download className="size-4" aria-hidden /> Download PDF
    </a>
  );
}
