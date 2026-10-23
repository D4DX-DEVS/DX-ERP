import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PayrollRun, SalaryAdvance } from "@/lib/models";
import { monthParam, pageParam, PAGE_SIZE, param, type SearchParams } from "@/lib/query";
import { inr, plural, round2 } from "@/lib/format";
import { fmtDate, monthKey } from "@/lib/time";
import { KIND_LABEL, periodLabel } from "@/lib/payroll/constants";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Chip, StatusChip } from "@/components/ui/chip";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { ClearFilters, DateFilter, FilterBar, Pagination, SelectFilter } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/tabs";
import { statusLabel } from "@/lib/status";
import { NewRunDialog } from "./new-run";

export const metadata = { title: "Payroll & stipends" };

const STATUSES = ["draft", "verified", "approved", "paid", "cancelled"] as const;

export default async function PayrollPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("payroll.view");
  const sp = await searchParams;
  const page = pageParam(sp);

  const kind = param(sp, "kind");
  const status = param(sp, "status");
  const period = monthParam(sp, "period");
  const filter = and(
    kind === "salary" || kind === "stipend" ? eq(PayrollRun.kind, kind) : undefined,
    (STATUSES as readonly string[]).includes(status) ? eq(PayrollRun.status, status as (typeof STATUSES)[number]) : undefined,
    period ? eq(PayrollRun.period, period) : undefined,
  );

  const [rows, total, awaitingApproval, awaitingPayment, advances] = await Promise.all([
    db()
      .select({
        _id: PayrollRun._id,
        runNo: PayrollRun.runNo,
        period: PayrollRun.period,
        kind: PayrollRun.kind,
        status: PayrollRun.status,
        totals: PayrollRun.totals,
        preparedByName: PayrollRun.preparedByName,
        createdAt: PayrollRun.createdAt,
      })
      .from(PayrollRun)
      .where(filter)
      .orderBy(desc(PayrollRun.period), desc(PayrollRun.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(PayrollRun, filter),
    db().select({ totals: PayrollRun.totals }).from(PayrollRun).where(eq(PayrollRun.status, "verified")),
    db().select({ totals: PayrollRun.totals }).from(PayrollRun).where(eq(PayrollRun.status, "approved")),
    db().select({ amount: SalaryAdvance.amount, recovered: SalaryAdvance.recovered }).from(SalaryAdvance).where(eq(SalaryAdvance.status, "open")),
  ]);
  const approvalNet = awaitingApproval.reduce((s, r) => s + r.totals.net, 0);
  const paymentNet = awaitingPayment.reduce((s, r) => s + r.totals.net, 0);
  const advanceBalance = round2(advances.reduce((s, a) => s + (a.amount - a.recovered), 0));
  const hasFilters = Boolean(kind || status || period);
  const prepare = can(user, "payroll.prepare");
  const current = monthKey();

  return (
    <PageBody>
      <PageHeader
        overline="Finance · restricted to HR, Finance & Management"
        title="Payroll & stipends"
        actions={prepare ? <NewRunDialog defaultPeriod={current} maxPeriod={current} /> : undefined}
      />
      <LinkTabs
        items={[
          { href: "/payroll", label: "Runs", active: true },
          { href: "/payroll/advances", label: "Salary advances" },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Latest run" value={rows[0] && !hasFilters ? periodLabel(rows[0].period) : "—"} sub={rows[0] && !hasFilters ? `${KIND_LABEL[rows[0].kind]} · ${statusLabel("payrollRun", rows[0].status)}` : "No runs yet"} />
        <StatCard label="Awaiting approval" value={awaitingApproval.length} sub={awaitingApproval.length ? `Net ${inr(approvalNet)}` : "Nothing waiting"} tone={awaitingApproval.length ? "brand" : "default"} />
        <StatCard label="Approved, to pay" value={awaitingPayment.length} sub={awaitingPayment.length ? `Net ${inr(paymentNet)}` : "Nothing to pay"} />
        <StatCard label="Advances to recover" value={inr(advanceBalance)} sub={plural(advances.length, "open advance")} href="/payroll/advances" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft p-4">
          <FilterBar>
            <SelectFilter param="kind" allLabel="Salary & stipend" label="Kind" options={[{ value: "salary", label: "Salary" }, { value: "stipend", label: "Stipend" }]} />
            <SelectFilter param="status" allLabel="All statuses" label="Status" options={STATUSES.map((s) => ({ value: s, label: statusLabel("payrollRun", s) }))} />
            <DateFilter param="period" label="Month" type="month" />
            <ClearFilters />
          </FilterBar>
        </div>
        <TableWrap phone={[1, 4]} tablet={[1, 2, 4, 7]}>
          <THead>
            <Th>Run</Th>
            <Th>Period</Th>
            <Th>Kind</Th>
            <Th>Status</Th>
            <Th align="right">People</Th>
            <Th align="right">Gross</Th>
            <Th align="right">Net</Th>
            <Th>Prepared</Th>
          </THead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={8}>{hasFilters ? "No runs match these filters." : prepare ? "No payroll runs yet. Create one with “New run”." : "No payroll runs yet."}</EmptyRow>
            )}
            {rows.map((r) => (
              <Tr key={r._id}>
                <Td>
                  <Link href={`/payroll/${r._id}`} className="font-mono text-xs font-semibold text-brand-600 hover:text-brand-800">
                    {r.runNo}
                  </Link>
                </Td>
                <Td className="font-semibold whitespace-nowrap">{periodLabel(r.period)}</Td>
                <Td>
                  <Chip tone={r.kind === "salary" ? "blue" : "purple"} dot={false} size="sm">
                    {KIND_LABEL[r.kind]}
                  </Chip>
                </Td>
                <Td>
                  <StatusChip domain="payrollRun" value={r.status} />
                </Td>
                <Td align="right">{r.totals.count}</Td>
                <Td align="right">{inr(r.totals.gross)}</Td>
                <Td align="right" className="font-semibold">
                  {inr(r.totals.net)}
                </Td>
                <Td className="text-xs text-muted">
                  {r.preparedByName ?? "—"}
                  <div>{fmtDate(r.createdAt)}</div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
      <p className="text-xs text-muted">Statutory deductions (PF, ESI, professional tax, TDS) follow the components set in Configuration — review them with your accountant before going live.</p>
    </PageBody>
  );
}
