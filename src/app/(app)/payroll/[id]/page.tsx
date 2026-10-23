import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Download } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { PayrollRun, Payslip } from "@/lib/models";
import { param, type SearchParams } from "@/lib/query";
import { inr, plural, round2 } from "@/lib/format";
import { addMonths, fmtDate, fmtDateTime, monthRange, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { KIND_LABEL, periodLabel } from "@/lib/payroll/constants";
import { payslipFlags, reimbursementTotal, type PayslipFlag } from "@/lib/payroll/calc";
import { cn } from "@/lib/cn";
import { Alert, PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Chip, StatusChip } from "@/components/ui/chip";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { ChipFilters, ClearFilters, FilterBar, SearchInput } from "@/components/ui/filters";
import { Menu } from "@/components/ui/menu";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { PayslipEditDialog, PayslipPayDialog, RunWorkflowButtons } from "./run-actions";

export const metadata = { title: "Payroll run" };

const FLAG_TEXT: Record<PayslipFlag["tone"], string> = { red: "text-danger", amber: "text-warning", blue: "text-brand-600" };
const HISTORY_LABEL: Record<string, string> = { created: "Run created", recalculated: "Recalculated", lines_edited: "Payslip lines edited", verified: "Verified", returned: "Sent back to draft", approved: "Approved", paid: "Fully paid", cancelled: "Cancelled" };

export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("payroll.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const run = await PayrollRun.findById(id).lean();
  if (!run) notFound();

  const prevPeriod = addMonths(run.period, -1);
  const [payslips, prevRun] = await Promise.all([
    Payslip.find({ run: run._id }).sort({ "snapshot.name": 1 }).lean(),
    PayrollRun.findOne({ period: prevPeriod, kind: run.kind, status: { $ne: "cancelled" } }, { totals: 1, runNo: 1 }).lean(),
  ]);
  const prevLop = prevRun ? ((await Payslip.aggregate<{ lop: number }>([{ $match: { run: prevRun._id } }, { $group: { _id: null, lop: { $sum: "$lopDays" } } }]))[0]?.lop ?? 0) : 0;

  const today = todayKey();
  const canPrepare = can(user, "payroll.prepare");
  const canApprove = can(user, "payroll.approve");
  const canPay = can(user, "payroll.pay");
  const kindLabel = KIND_LABEL[run.kind];
  const editable = run.status === "draft" && canPrepare;
  const monthInProgress = run.status === "draft" && today <= monthRange(run.period).to;

  const rows = payslips.map((p) => ({ p, flags: payslipFlags(p) }));
  const exceptions = rows.filter((r) => r.flags.some((f) => f.tone !== "blue"));
  const show = param(sp, "show");
  const q = param(sp, "q").toLowerCase();
  const shown = rows.filter((r) => (show === "exceptions" ? r.flags.some((f) => f.tone !== "blue") : true) && (!q || `${r.p.snapshot.name} ${r.p.snapshot.employeeId}`.toLowerCase().includes(q)));

  const reimbursements = round2(payslips.reduce((s, p) => s + reimbursementTotal(p.earnings), 0));
  const reimbursementCount = payslips.reduce((s, p) => s + p.earnings.filter((l) => l.key?.startsWith("reimb:")).length, 0);
  const lopTotal = round2(payslips.reduce((s, p) => s + p.lopDays, 0));
  const awaiting = payslips.filter((p) => p.status === "approved");
  const awaitingNet = round2(awaiting.reduce((s, p) => s + p.net, 0));

  const steps = [
    { title: "Calculated", who: `${run.preparedByName ?? "—"} · ${fmtDate(run.createdAt)}`, done: true },
    { title: "Verified", who: run.verifiedAt ? `${run.verifiedByName ?? "—"} · ${fmtDate(run.verifiedAt)}` : "HR / Finance", done: Boolean(run.verifiedAt) && run.status !== "draft" },
    { title: "Management approval", who: run.approvedAt ? `${run.approvedByName ?? "—"} · ${fmtDate(run.approvedAt)}` : "Management", done: run.status === "approved" || run.status === "paid" },
    { title: "Payment recorded", who: run.paidAt ? fmtDate(run.paidAt) : run.status === "approved" ? `${payslips.length - awaiting.length} of ${payslips.length} paid` : "Finance", done: run.status === "paid" },
    { title: "Payslips issued", who: "Automatic on payment", done: run.status === "paid" },
  ];
  const currentStep = steps.findIndex((s) => !s.done);

  const exportHref = (type: string, format: string) => `/payroll/${id}/export?type=${type}&format=${format}`;
  const exportItems = [
    ...(["csv", "xlsx", "pdf"] as const).map((f) => ({ label: `Payslip register · ${f.toUpperCase()}`, href: exportHref("register", f), external: true })),
    "separator" as const,
    ...(["csv", "xlsx", "pdf"] as const).map((f) => ({ label: `Component summary · ${f.toUpperCase()}`, href: exportHref("summary", f), external: true })),
    ...(run.status === "approved" || run.status === "paid"
      ? ["separator" as const, ...(["csv", "xlsx", "pdf"] as const).map((f) => ({ label: `Bank file · ${f.toUpperCase()}`, href: exportHref("bank", f), external: true }))]
      : []),
  ];

  const timeline: TimelineItem[] = [...run.history]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((h, i) => ({ id: String(i), title: HISTORY_LABEL[h.action] ?? h.action, meta: h.byName, at: h.at, body: h.note, tone: h.action === "approved" || h.action === "paid" ? "success" : h.action === "cancelled" || h.action === "returned" ? "danger" : "default" }));

  return (
    <PageBody>
      <PageHeader
        back={{ href: "/payroll", label: "Payroll & stipends" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>
              {kindLabel === "Salary" ? "Payroll" : "Stipends"} · {periodLabel(run.period)}
            </span>
            <StatusChip domain="payrollRun" value={run.status} />
          </span>
        }
        description={`${run.runNo} · ${plural(run.totals.count, "payslip")} · ${run.workingDays} pay-basis days`}
        actions={
          <>
            <Menu
              label="Export"
              trigger={
                <button type="button" className={buttonClass("secondary")}>
                  <Download className="size-4" aria-hidden /> Export
                </button>
              }
              items={exportItems}
            />
            <RunWorkflowButtons id={id} status={run.status} canPrepare={canPrepare} canApprove={canApprove} canPay={canPay} awaitingPayment={awaiting.length} netToPay={awaitingNet} today={today} />
          </>
        }
      />

      {run.status === "cancelled" ? (
        <Alert tone="danger" title="Cancelled.">
          {run.history.find((h) => h.action === "cancelled")?.note ?? "This run was cancelled."} You can create a new run for this month.
        </Alert>
      ) : (
        <ol className="m-0 flex list-none flex-wrap gap-3 rounded-[14px] border border-line bg-white p-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex min-w-[160px] flex-1 items-center gap-2.5">
              <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold", s.done ? "bg-success text-white" : i === currentStep ? "bg-brand-600 text-white" : "bg-track text-tone-gray")}>
                {s.done ? <Check className="size-4" aria-label="Done" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[13px]", i === currentStep ? "font-bold text-brand-600" : "font-semibold text-ink")}>{s.title}</span>
                <span className="block truncate text-xs text-muted">{s.who}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {monthInProgress && <Alert tone="warning" title="This month is not over yet.">Days after today are treated as payable. Recalculate just before verifying so the latest attendance and leave are used.</Alert>}
      {(run.status === "approved" || run.status === "paid") && <Alert tone="info">Approved and paid runs are locked. Corrections have to be made through a new entry, not by editing this run.</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Gross earnings" value={inr(run.totals.gross)} sub={`${plural(payslips.length, "payslip")}${reimbursements > 0 ? ` · includes ${inr(reimbursements)} reimbursements` : ""}`} />
        <StatCard label="Deductions" value={inr(run.totals.deductions)} sub={lopTotal > 0 ? `${lopTotal} unpaid ${lopTotal === 1 ? "day" : "days"} (loss of pay)` : "No unpaid days"} />
        <StatCard label="Reimbursements" value={inr(reimbursements)} sub={plural(reimbursementCount, "approved claim")} />
        <div className="flex min-w-0 flex-col rounded-[14px] bg-navy p-4 text-white sm:p-5">
          <span className="text-[13px] font-medium text-navy-soft">Net payable</span>
          <span className="mt-1 font-display text-[28px] leading-none font-semibold tabular">{inr(run.totals.net)}</span>
          <span className="mt-2 text-xs text-navy-text">{run.status === "approved" ? `${inr(awaitingNet)} still to pay` : run.status === "paid" ? `Paid ${run.paidAt ? fmtDate(run.paidAt) : ""}` : "After approval"}</span>
        </div>
      </div>

      <Alert tone="info">Statutory deductions (PF, ESI, professional tax, TDS) follow the components set in Configuration. Review them with your accountant before going live.</Alert>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="flex flex-col gap-3 border-b border-line-soft p-4">
            <ChipFilters
              param="show"
              allLabel={`All ${rows.length}`}
              options={[{ value: "exceptions", label: "Exceptions", count: exceptions.length }]}
            />
            <FilterBar>
              <SearchInput placeholder="Search name or employee ID…" />
              <ClearFilters />
            </FilterBar>
          </div>
          <TableWrap phone={[1, 5, "last"]} tablet={[1, 3, 5, 7, "last"]}>
            <THead>
              <Th>Person</Th>
              <Th align="right">Paid days</Th>
              <Th align="right">Gross</Th>
              <Th align="right">Deductions</Th>
              <Th align="right">Net</Th>
              <Th>Notes</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </THead>
            <tbody>
              {shown.length === 0 && <EmptyRow colSpan={8}>{rows.length === 0 ? "This run has no payslips." : "No payslips match these filters."}</EmptyRow>}
              {shown.map(({ p, flags }) => (
                <Tr key={p._id.toString()}>
                  <Td>
                    <div className="font-semibold">{p.snapshot.name}</div>
                    <div className="text-xs text-muted">
                      {p.snapshot.employeeId}
                      {p.snapshot.department ? ` · ${p.snapshot.department}` : ""}
                    </div>
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    {p.payableDays} / {p.workingDays}
                  </Td>
                  <Td align="right">{inr(p.gross, true)}</Td>
                  <Td align="right">{p.totalDeductions ? inr(p.totalDeductions, true) : "—"}</Td>
                  <Td align="right" className="font-bold">
                    {inr(p.net, true)}
                  </Td>
                  <Td className="max-w-[220px]">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs font-semibold">
                      {flags.length === 0 && <span className="text-subtle">—</span>}
                      {flags.map((f) => (
                        <span key={f.label} className={FLAG_TEXT[f.tone]}>
                          {f.label}
                        </span>
                      ))}
                    </div>
                    {p.remarks && <div className="mt-0.5 text-xs text-muted">{p.remarks}</div>}
                  </Td>
                  <Td>
                    <StatusChip domain="payslip" value={p.status} size="sm" />
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-1.5">
                      {editable && p.status === "draft" && (
                        <PayslipEditDialog
                          id={p._id.toString()}
                          name={p.snapshot.name}
                          earnings={p.earnings.filter((l) => l.source === "manual").map((l) => ({ name: l.name, amount: String(l.amount) }))}
                          deductions={p.deductions.filter((l) => l.source === "manual").map((l) => ({ name: l.name, amount: String(l.amount) }))}
                          remarks={p.remarks ?? ""}
                        />
                      )}
                      {run.status === "approved" && canPay && p.status === "approved" && <PayslipPayDialog id={p._id.toString()} name={p.snapshot.name} net={p.net} today={today} />}
                      <Link href={`/payslips/${p._id}`} className="text-[13px] font-semibold text-brand-600 hover:text-brand-800">
                        View
                      </Link>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>

        <aside className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Exceptions to review" />
            <CardBody className="flex flex-col">
              {exceptions.length === 0 && <p className="text-[13px] text-muted">No exceptions. Everyone has a bank account and full attendance.</p>}
              {exceptions.slice(0, 12).map(({ p, flags }) => (
                <div key={p._id.toString()} className="border-t border-line-soft py-2.5 text-[13px] first:border-t-0 first:pt-0">
                  <strong className="font-semibold">{p.snapshot.name}</strong>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {flags
                      .filter((f) => f.tone !== "blue")
                      .map((f) => (
                        <Chip key={f.label} tone={f.tone === "red" ? "red" : "amber"} dot={false} size="sm">
                          {f.label}
                        </Chip>
                      ))}
                  </div>
                </div>
              ))}
              {exceptions.length > 12 && <p className="pt-2 text-xs text-muted">and {exceptions.length - 12} more — use the Exceptions filter.</p>}
            </CardBody>
          </Card>

          {prevRun && (
            <Card>
              <CardHeader title={`vs ${periodLabel(prevPeriod)}`} subtitle={prevRun.runNo} />
              <CardBody className="flex flex-col gap-2.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Net payable</span>
                  <span className="text-right">
                    {inr(prevRun.totals.net)} → <strong>{inr(run.totals.net)}</strong>
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Headcount</span>
                  <span>
                    {prevRun.totals.count} → <strong>{run.totals.count}</strong>
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Unpaid days</span>
                  <span>
                    {prevLop} → <strong>{lopTotal}</strong>
                  </span>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <Timeline items={timeline} />
            </CardBody>
          </Card>
          <p className="px-1 text-xs text-muted">Updated {fmtDateTime(run.updatedAt)}</p>
        </aside>
      </div>
    </PageBody>
  );
}
