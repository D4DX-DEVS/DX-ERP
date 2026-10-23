import Link from "next/link";
import { forbidden } from "next/navigation";
import { Download, Plus } from "lucide-react";
import { can, isStaff, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Department, Expense, Project } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { namesFor, peopleOptions } from "@/lib/people";
import { pageParam, PAGE_SIZE, param, type SearchParams } from "@/lib/query";
import { inr, plural } from "@/lib/format";
import { fmtDate, monthKey, monthRange, todayKey } from "@/lib/time";
import { statusLabel } from "@/lib/status";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Chip, StatusChip } from "@/components/ui/chip";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { ChipFilters, ClearFilters, DateFilter, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/tabs";
import { Menu } from "@/components/ui/menu";
import { HBarList } from "@/components/ui/charts";
import { allowedViews, expenseFilters, EXPENSE_STATUSES, resolveView, type ExpenseView } from "./data";
import { ApproveExpenseButton, PayExpenseDialog, RejectExpenseButton } from "./expense-actions";
import { EXPENSE_TYPE_LABEL } from "./constants";

export const metadata = { title: "Expenses" };

interface Total {
  amount: number;
  count: number;
}

async function totalOf(match: Record<string, unknown>): Promise<Total> {
  const [row] = await Expense.aggregate<Total>([{ $match: match }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]);
  return { amount: row?.amount ?? 0, count: row?.count ?? 0 };
}

const VIEW_LABEL: Record<ExpenseView, string> = { mine: "My expenses", all: "All expenses", approve: "Approvals", pay: "To pay" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view = resolveView(user, param(sp, "view"));
  if (!view) forbidden();

  await connectDB();
  const viewAll = can(user, "expenses.view_all");
  const approve = can(user, "expenses.approve");
  const pay = can(user, "expenses.pay");
  const staff = isStaff(user);
  const today = todayKey();
  const month = monthRange(monthKey());
  const page = pageParam(sp);
  const { filter, withoutStatus } = expenseFilters(user, view, sp);
  const scope: Record<string, unknown> = viewAll ? {} : { user: user._id };
  const showAside = view === "mine" || view === "all";
  const settings = await getSettings();

  const [rows, total, byStatus, byCategory, recorded, waiting, toReimburse, charged, approvalCount, payCount, pendingForMe, projects, departments, people] = await Promise.all([
    Expense.find(filter).sort({ date: -1, createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Expense.countDocuments(filter),
    Expense.aggregate<{ _id: string; amount: number; count: number }>([{ $match: withoutStatus }, { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    Expense.aggregate<{ _id: string; amount: number; count: number }>([{ $match: filter }, { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    totalOf({ ...scope, status: { $in: ["submitted", "approved", "paid"] }, date: { $gte: month.from, $lte: month.to } }),
    totalOf({ ...scope, status: "submitted" }),
    totalOf({ ...scope, status: "approved", type: "reimbursable" }),
    Expense.aggregate<{ _id: string; amount: number }>([
      { $match: { ...scope, project: { $exists: true, $ne: null }, status: { $in: ["approved", "paid"] }, date: { $gte: month.from, $lte: month.to } } },
      { $group: { _id: "$project", amount: { $sum: "$amount" } } },
    ]),
    approve ? Expense.countDocuments({ status: "submitted", user: { $ne: user._id } }) : Promise.resolve(0),
    pay ? Expense.countDocuments({ status: "approved" }) : Promise.resolve(0),
    approve && view !== "approve" ? Expense.find({ status: "submitted", user: { $ne: user._id } }).sort({ submittedAt: 1 }).limit(5).lean() : Promise.resolve([]),
    // Only projects the viewer can see (the filter must not list every project to every claimant).
    Project.find(can(user, "projects.view_all") ? {} : { $or: [{ manager: user._id }, { "team.user": user._id }] }, { projectNo: 1, title: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
    Department.find({}, { name: 1 }).sort({ name: 1 }).lean(),
    view === "all" ? peopleOptions({ includeExited: true }) : Promise.resolve([]),
  ]);

  const names = await namesFor([...rows.map((r) => r.user), ...pendingForMe.map((r) => r.user)]);
  const projectLabel = new Map(projects.map((p) => [p._id.toString(), p.projectNo]));
  const statusTotals = new Map(byStatus.map((s) => [s._id, s]));
  const chargedTotal = charged.reduce((s, c) => s + c.amount, 0);
  const hasFilters = ["status", "category", "project", "department", "person", "from", "to", "q"].some((k) => param(sp, k));
  const scopeLabel = viewAll ? "Everyone" : "You";

  const tabs = allowedViews(user).map((v) => ({
    href: `/expenses?view=${v}`,
    label: v === "mine" && (viewAll || approve) ? "My expenses" : VIEW_LABEL[v],
    active: v === view,
    count: v === "approve" ? approvalCount : v === "pay" ? payCount : undefined,
  }));

  const exportHref = (format: string) => {
    const q = new URLSearchParams({ view, format });
    for (const k of ["status", "category", "project", "department", "person", "from", "to", "q"]) {
      const v = param(sp, k);
      if (v) q.set(k, v);
    }
    return `/expenses/export?${q.toString()}`;
  };

  const showActions = view === "approve" || view === "pay";
  const showPerson = view !== "mine";

  return (
    <PageBody>
      <PageHeader
        overline="Finance"
        title={viewAll || approve ? "Expenses" : "My expenses"}
        actions={
          <>
            <Menu
              label="Export expenses"
              trigger={
                <button type="button" className={buttonClass("secondary")}>
                  <Download className="size-4" aria-hidden /> Export
                </button>
              }
              items={[
                { label: "CSV", href: exportHref("csv"), external: true },
                { label: "Excel", href: exportHref("xlsx"), external: true },
                { label: "PDF", href: exportHref("pdf"), external: true },
              ]}
            />
            {staff && (
              <ButtonLink href="/expenses/new" icon={<Plus className="size-4" aria-hidden />}>
                New expense
              </ButtonLink>
            )}
          </>
        }
      />

      {tabs.length > 1 && <LinkTabs items={tabs} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Recorded · ${fmtDate(month.from, "MMMM")}`} value={inr(recorded.amount)} sub={`${plural(recorded.count, "entry", "entries")} · ${scopeLabel.toLowerCase()}`} />
        <StatCard label="Waiting for approval" value={<span className="text-warning">{inr(waiting.amount)}</span>} sub={plural(waiting.count, "claim")} />
        <StatCard label="To reimburse" value={inr(toReimburse.amount)} sub={`${plural(toReimburse.count, "approved claim")} · direct or with payroll`} />
        <StatCard label="Charged to projects" value={inr(chargedTotal)} sub={`${plural(charged.length, "project")} this month`} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="flex flex-col gap-3 border-b border-line-soft p-4">
            {(view === "mine" || view === "all") && (
              <ChipFilters
                param="status"
                allLabel="All"
                options={EXPENSE_STATUSES.map((s) => ({ value: s, label: statusLabel("expense", s), count: statusTotals.get(s)?.count ?? 0 }))}
              />
            )}
            {view === "approve" && <p className="text-[13px] text-muted">Submitted by others and waiting for a decision, oldest first. You cannot approve your own.</p>}
            {view === "pay" && <p className="text-[13px] text-muted">Approved expenses that have not been paid. Claims included in an open payroll run are paid with that run.</p>}
            <FilterBar>
              <SearchInput placeholder="Search number, description, vendor…" />
              <SelectFilter param="category" allLabel="All categories" label="Category" options={settings.expenseCategories.map((c) => ({ value: c, label: c }))} className="w-44" />
              <SelectFilter param="project" allLabel="All projects" label="Project" options={projects.map((p) => ({ value: p._id.toString(), label: `${p.projectNo} · ${p.title}` }))} className="w-44" />
              <SelectFilter param="department" allLabel="All departments" label="Department" options={departments.map((d) => ({ value: d._id.toString(), label: d.name }))} className="w-44" />
              {view === "all" && <SelectFilter param="person" allLabel="Everyone" label="Person" options={people.map((p) => ({ value: p.id, label: p.name }))} className="w-44" />}
              <DateFilter param="from" label="From" />
              <DateFilter param="to" label="to" />
              <ClearFilters keep={["view"]} />
            </FilterBar>
          </div>
          <TableWrap phone={showPerson ? [1, 4, 6, "last"] : [1, 3, 5, "last"]} tablet={showPerson ? [1, 3, 4, 6, "last"] : [1, 2, 3, 5, "last"]}>
            <THead>
              <Th>Expense</Th>
              <Th>Category · project</Th>
              {showPerson && <Th>By</Th>}
              <Th align="right">Amount</Th>
              <Th>Receipt</Th>
              <Th>Status</Th>
              {showActions && <Th align="right">Action</Th>}
            </THead>
            <tbody>
              {rows.length === 0 && (
                <EmptyRow colSpan={5 + (showPerson ? 1 : 0) + (showActions ? 1 : 0)}>
                  {hasFilters
                    ? "No expenses match these filters."
                    : view === "approve"
                      ? "Nothing is waiting for approval."
                      : view === "pay"
                        ? "No approved expenses are waiting for payment."
                        : view === "mine"
                          ? "You haven't recorded any expenses yet. Use “New expense” to add one."
                          : "No expenses recorded yet."}
                </EmptyRow>
              )}
              {rows.map((r) => {
                const id = r._id.toString();
                return (
                  <Tr key={id}>
                    <Td>
                      <Link href={`/expenses/${id}`} className="font-semibold text-ink hover:text-brand-600">
                        {r.description.length > 60 ? `${r.description.slice(0, 59)}…` : r.description}
                      </Link>
                      <div className="text-xs text-muted">
                        <span className="font-mono">{r.expenseNo}</span> · {fmtDate(r.date)}
                      </div>
                    </Td>
                    <Td>
                      <div>{r.category}</div>
                      <div className="text-xs text-muted">{r.project ? (projectLabel.get(r.project.toString()) ?? "Project") : EXPENSE_TYPE_LABEL[r.type]}</div>
                    </Td>
                    {showPerson && <Td className="text-ink-2">{names.get(r.user.toString()) ?? "—"}</Td>}
                    <Td align="right" className="font-semibold">
                      {inr(r.amount, true)}
                    </Td>
                    <Td className={r.receipts.length ? "text-xs font-semibold text-success" : "text-xs font-semibold text-danger"}>{r.receipts.length ? "Attached" : "Missing"}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusChip domain="expense" value={r.status} />
                        {r.status === "approved" && r.type === "reimbursable" && <Chip tone="blue" dot={false} size="sm">To reimburse</Chip>}
                      </div>
                    </Td>
                    {showActions && (
                      <Td align="right">
                        <div className="flex justify-end gap-2">
                          {view === "approve" && (
                            <>
                              <RejectExpenseButton id={id} size="sm" />
                              <ApproveExpenseButton id={id} size="sm" />
                            </>
                          )}
                          {view === "pay" && <PayExpenseDialog id={id} amount={r.amount} today={today} reimbursable={r.type === "reimbursable"} size="sm" />}
                        </div>
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>

        <aside className="flex min-w-0 flex-col gap-4">
          {showAside && (
            <Card>
              <CardHeader title="By category" subtitle={hasFilters ? "For the current filters" : "All time"} />
              <CardBody>
                {byCategory.length === 0 ? <p className="text-[13px] text-muted">No expenses to total yet.</p> : <HBarList format="inr" rows={byCategory.map((c) => ({ label: c._id, value: c.amount, hint: `${c._id} · ${plural(c.count, "entry", "entries")}` }))} />}
              </CardBody>
            </Card>
          )}
          {showAside && (
            <Card>
              <CardHeader title="By status" />
              <CardBody>
                <ul className="flex flex-col gap-2 text-[13px]">
                  {EXPENSE_STATUSES.map((s) => {
                    const t = statusTotals.get(s);
                    return (
                      <li key={s} className="flex items-center justify-between gap-2">
                        <StatusChip domain="expense" value={s} size="sm" />
                        <span className="text-muted">{plural(t?.count ?? 0, "entry", "entries")}</span>
                        <span className="min-w-20 text-right font-semibold tabular">{inr(t?.amount ?? 0)}</span>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          )}
          {pendingForMe.length > 0 && (
            <Card>
              <CardHeader title="Waiting for your approval" href="/expenses?view=approve" hrefLabel="Open queue" />
              <CardBody className="flex flex-col">
                {pendingForMe.map((r) => (
                  <div key={r._id.toString()} className="flex flex-col gap-2 border-t border-line-soft py-3 first:border-t-0 first:pt-0">
                    <div className="text-[13px]">
                      <Link href={`/expenses/${r._id}`} className="font-semibold text-ink hover:text-brand-600">
                        {names.get(r.user.toString()) ?? "Someone"} · {inr(r.amount, true)}
                      </Link>
                      <div className="text-muted">
                        {r.category} · {r.receipts.length ? "receipt attached" : "no receipt"}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <RejectExpenseButton id={r._id.toString()} size="sm" />
                      <ApproveExpenseButton id={r._id.toString()} size="sm" />
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
          {!showAside && pendingForMe.length === 0 && (
            <Card>
              <CardBody className="pt-5 text-[13px] text-muted">
                {view === "approve" ? "Approve or reject each claim. The person is notified straight away." : "Record the payment once the money has been sent. The person is notified."}
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </PageBody>
  );
}
