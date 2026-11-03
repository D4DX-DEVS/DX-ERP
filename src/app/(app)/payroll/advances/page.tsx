import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SalaryAdvance } from "@/lib/models";
import { namesFor, peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, sortParam, type SearchParams, type SortChoices } from "@/lib/query";
import { inr, plural, round2 } from "@/lib/format";
import { fmtDate, todayKey } from "@/lib/time";
import { periodLabel } from "@/lib/payroll/constants";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SelectFilter, SortSelect } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/tabs";
import { AdvanceDialog } from "./advance-dialog";

export const metadata = { title: "Salary advances" };

const SORTS = {
  date: { label: "Date given (newest)", order: [desc(SalaryAdvance.date), desc(SalaryAdvance.createdAt)] },
  dateAsc: { label: "Date given (oldest)", order: [asc(SalaryAdvance.date), asc(SalaryAdvance.createdAt)] },
  amountDesc: { label: "Amount (high → low)", order: [desc(SalaryAdvance.amount), desc(SalaryAdvance.date)] },
  amountAsc: { label: "Amount (low → high)", order: [asc(SalaryAdvance.amount), desc(SalaryAdvance.date)] },
  remaining: { label: "Remaining (high → low)", order: [desc(sql`${SalaryAdvance.amount} - ${SalaryAdvance.recovered}`), desc(SalaryAdvance.date)] },
  updated: { label: "Recently updated", order: [desc(SalaryAdvance.updatedAt)] },
} satisfies SortChoices<SQL[]>;

export default async function AdvancesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("payroll.view");
  const sp = await searchParams;
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const record = can(user, "payroll.prepare") || can(user, "payroll.pay");

  const status = param(sp, "status");
  const person = idParam(sp, "person");
  const filter = and(status === "open" || status === "closed" ? eq(SalaryAdvance.status, status) : undefined, person ? eq(SalaryAdvance.user, person) : undefined);

  const [rows, total, open, people] = await Promise.all([
    db().select().from(SalaryAdvance).where(filter).orderBy(...sort.order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db().$count(SalaryAdvance, filter),
    db().select({ amount: SalaryAdvance.amount, recovered: SalaryAdvance.recovered, monthlyRecovery: SalaryAdvance.monthlyRecovery }).from(SalaryAdvance).where(eq(SalaryAdvance.status, "open")),
    peopleOptions({ includeExited: true }),
  ]);
  const names = await namesFor(rows.map((r) => r.user));
  const remaining = round2(open.reduce((s, a) => s + (a.amount - a.recovered), 0));
  const monthly = round2(open.reduce((s, a) => s + Math.min(a.monthlyRecovery, a.amount - a.recovered), 0));
  const hasFilters = Boolean(status || person);

  return (
    <PageBody>
      <PageHeader
        overline="Finance · restricted to HR, Finance & Management"
        title="Salary advances"
        actions={record ? <AdvanceDialog people={people.filter((p) => p.personType !== "admin")} today={todayKey()} /> : undefined}
      />
      <LinkTabs
        items={[
          { href: "/payroll", label: "Runs" },
          { href: "/payroll/advances", label: "Salary advances", active: true },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open advances" value={open.length} sub={open.length ? "Being recovered from payslips" : "Nothing outstanding"} />
        <StatCard label="Still to recover" value={inr(remaining)} />
        <StatCard label="Recovered per month" value={inr(monthly)} sub="At the current monthly amounts" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft p-4">
          <ChipFilters param="status" allLabel="All" options={[{ value: "open", label: "Open" }, { value: "closed", label: "Cleared" }]} />
          <FilterBar>
            <SelectFilter param="person" allLabel="Everyone" label="Person" options={people.map((p) => ({ value: p.id, label: p.name }))} className="w-48" />
            <SortSelect options={sort.options} />
            <ClearFilters />
          </FilterBar>
        </div>
        <TableWrap phone={[1, 7, 8]} tablet={[1, 4, 7, 8]}>
          <THead>
            <Th>Person</Th>
            <Th>Given</Th>
            <Th>Reason</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Per month</Th>
            <Th align="right">Recovered</Th>
            <Th align="right">Remaining</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>{hasFilters ? "No advances match these filters." : "No salary advances recorded."}</EmptyRow>}
            {rows.map((a) => (
              <Tr key={a._id} className="align-top">
                <Td>
                  <div className="font-semibold">{names.get(a.user) ?? "—"}</div>
                  <div className="text-xs text-muted">{a.recordedByName ? `Recorded by ${a.recordedByName}` : ""}</div>
                </Td>
                <Td className="whitespace-nowrap">{fmtDate(a.date)}</Td>
                <Td className="max-w-[240px] text-ink-2">
                  {a.reason || "—"}
                  {a.recoveries.length > 0 && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer font-semibold text-brand-600">Recovery history ({plural(a.recoveries.length, "payment")})</summary>
                      <ul className="mt-1 flex flex-col gap-0.5 text-muted">
                        {a.recoveries.map((r, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{periodLabel(r.period)}</span>
                            <span className="tabular">{inr(r.amount, true)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </Td>
                <Td align="right">{inr(a.amount, true)}</Td>
                <Td align="right">{inr(a.monthlyRecovery, true)}</Td>
                <Td align="right">{inr(a.recovered, true)}</Td>
                <Td align="right" className="font-semibold">
                  {inr(round2(a.amount - a.recovered), true)}
                </Td>
                <Td>
                  <Chip tone={a.status === "open" ? "amber" : "green"}>{a.status === "open" ? "Open" : "Cleared"}</Chip>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </PageBody>
  );
}
