import { ChevronLeft, ChevronRight, Download, Repeat } from "lucide-react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { ActionButton } from "@/components/ui/actions";
import { PersonCell } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Input, Select } from "@/components/ui/input";
import { PageBody, PageHeader } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bulkLeaveBalances, leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { Department, User } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { PAGE_SIZE, idParam, pageParam, param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { notInList, inList, searchAny } from "@/lib/sql";
import { cn } from "@/lib/cn";
import { fmtDate, todayKey } from "@/lib/time";
import { carryForward } from "../actions";
import { LeaveTabs } from "../_components/tabs";
import { leaveAccess } from "../_lib/access";
import { EXITED_STATUSES, STAFF_TYPES } from "../../attendance/_lib/access";
import { AdjustBalanceDialog } from "./adjust-dialog";

export const metadata = { title: "Leave balances" };

export default async function LeaveBalancesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("leave.manage");
  const access = await leaveAccess(user);
  const sp = await searchParams;
  const settings = await getSettings();
  const today = todayKey();
  const requestedYear = Number.parseInt(param(sp, "year"), 10);
  const year = Number.isFinite(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100 ? requestedYear : leaveYearOf(today, settings);
  const range = leaveYearRange(year, settings);
  const q = param(sp, "q");
  const dept = idParam(sp, "dept");
  const page = pageParam(sp);

  const filter = and(
    inList(User.personType, STAFF_TYPES),
    notInList(User.status, EXITED_STATUSES),
    dept ? eq(User.department, dept) : undefined,
    q ? searchAny(q, User.name, User.employeeId) : undefined,
  );

  const [total, people, departments, options] = await Promise.all([
    db().$count(User, filter),
    db()
      .select({ _id: User._id, name: User.name, employeeId: User.employeeId, photo: User.photo, personType: User.personType, department: User.department })
      .from(User)
      .where(filter)
      .orderBy(asc(User.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().select({ _id: Department._id, name: Department.name }).from(Department).orderBy(asc(Department.name)),
    peopleOptions(),
  ]);
  const { types, rows, stored } = await bulkLeaveBalances(people.map((p) => ({ id: p._id, personType: p.personType })), year, settings, today);
  const deptName = new Map(departments.map((d) => [d._id, d.name]));

  const yearLink = (y: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (dept) p.set("dept", dept);
    p.set("year", String(y));
    return `/leave/balances?${p.toString()}`;
  };
  const arrow = "flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-field";

  return (
    <PageBody>
      <PageHeader
        overline={`Time · leave year ${fmtDate(range.from, "MMM yyyy")} – ${fmtDate(range.to, "MMM yyyy")}`}
        title="Leave balances"
        description="Adjust balances, override quotas and carry unused leave into the next year."
        actions={
          <>
            <div className="flex h-10 items-center rounded-[10px] border border-line-strong bg-white" role="group" aria-label="Leave year">
              <Link href={yearLink(year - 1)} aria-label="Previous leave year" className={arrow}>
                <ChevronLeft className="size-4" />
              </Link>
              <span className="min-w-14 px-2 text-center text-sm font-semibold">{year}</span>
              <Link href={yearLink(year + 1)} aria-label="Next leave year" className={arrow}>
                <ChevronRight className="size-4" />
              </Link>
            </div>
            <ActionButton
              action={carryForward.bind(null, year)}
              variant="secondary"
              icon={<Repeat className="size-4" />}
              confirm={`Carry unused balance from ${year} into ${year + 1}? Each leave type with carry-forward keeps up to its maximum. Running it again only updates balances that changed.`}
              successMessage="Carry-forward applied"
            >
              Carry forward {year} → {year + 1}
            </ActionButton>
          </>
        }
      />
      <LeaveTabs active="balances" access={access} />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
          <FilterBar>
            <SearchInput placeholder="Search people" />
            <SelectFilter param="dept" label="Department" allLabel="All departments" options={departments.map((d) => ({ value: d._id, label: d.name }))} />
            <ClearFilters keep={["year"]} />
          </FilterBar>
          <span className="ml-auto text-xs text-muted">Select a balance to adjust it</span>
        </div>
        <TableWrap phone={[1, 2, 3]} tablet={[1, 2, 3, 4, 5]}>
          <THead>
            <Th>Person</Th>
            {types.map((t) => (
              <Th key={t._id}>{t.name}</Th>
            ))}
          </THead>
          <tbody>
            {people.length === 0 && <EmptyRow colSpan={types.length + 1}>No staff match these filters.</EmptyRow>}
            {people.map((p) => {
              const id = p._id;
              return (
                <Tr key={id}>
                  <Td>
                    <PersonCell name={p.name} photo={p.photo ?? undefined} sub={[p.employeeId, p.department ? deptName.get(p.department) : undefined].filter(Boolean).join(" · ")} />
                  </Td>
                  {types.map((t) => {
                    const row = rows.get(id)?.get(t._id);
                    if (!row) return <Td key={t._id}><span className="text-muted">—</span></Td>;
                    const s = stored.get(`${id}:${t._id}`);
                    const total = row.accrued + row.carriedForward + row.adjustment;
                    return (
                      <Td key={t._id}>
                        <AdjustBalanceDialog
                          userId={id}
                          userName={p.name}
                          leaveTypeId={t._id}
                          leaveTypeName={t.name}
                          year={year}
                          summary={{ ...row, quotaOverride: s?.quotaOverride ?? undefined, defaultQuota: row.annualQuota }}
                          notes={(s?.notes ?? []).slice(-5).reverse().map((n) => ({ amount: n.amount, reason: n.reason, byName: n.byName, at: n.at.toISOString() }))}
                          trigger={
                            <button type="button" className="group -mx-2 flex min-w-24 flex-col rounded-lg px-2 py-1 text-left hover:bg-brand-50" aria-label={`Adjust ${t.name} balance for ${p.name}`}>
                              <span className={cn("text-sm font-semibold tabular", row.available < 0 && "text-danger")}>{row.unlimited ? `${row.used} used` : row.available}</span>
                              <span className="text-xs text-muted tabular">
                                {row.unlimited ? "no limit" : `${row.used} used of ${total}`}
                                {row.pending > 0 ? ` · ${row.pending} pending` : ""}
                                {s?.quotaOverride != null ? " · custom quota" : row.prorated ? " · pro-rated" : ""}
                              </span>
                            </button>
                          }
                        />
                      </Td>
                    );
                  })}
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>

      <Card>
        <CardHeader title="Leave report" subtitle="Download requests by employee and date range (defaults to this leave year)." />
        <CardBody>
          <form action="/leave/export" method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Employee
              <Select name="user" defaultValue="">
                <option value="">All employees</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.employeeId})
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              From
              <Input type="date" name="from" defaultValue={range.from} />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              To
              <Input type="date" name="to" defaultValue={range.to} />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Format
              <Select name="format" defaultValue="xlsx">
                <option value="xlsx">Excel (XLSX)</option>
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
              </Select>
            </label>
            <Button type="submit" icon={<Download className="size-4" />}>
              Download
            </Button>
          </form>
        </CardBody>
      </Card>
    </PageBody>
  );
}
