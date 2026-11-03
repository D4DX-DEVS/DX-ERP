import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { and, asc, desc, isNotNull, type SQL } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Invoice, Payment, Project } from "@/lib/models";
import { pageParam, PAGE_SIZE, param, sortParam, type SearchParams, type SortChoices } from "@/lib/query";
import { inr, plural } from "@/lib/format";
import { fmtDate, todayKey } from "@/lib/time";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { ChipFilters, ClearFilters, DateFilter, FilterBar, Pagination, SearchInput, SelectFilter, SortSelect } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/tabs";
import { Menu } from "@/components/ui/menu";
import { statusLabel } from "@/lib/status";
import { cn } from "@/lib/cn";
import { clientScope, hiddenClientIds, notHiddenClient } from "@/app/(app)/crm/_lib/access";
import {
  AGING_BUCKETS,
  INVOICE_BUCKETS,
  bucketFilter,
  fiscalRange,
  invoiceFilter,
  invoicedBetween,
  loadReceivables,
  monthRangeOf,
  receivedBetween,
} from "./data";
import { effectiveStatus } from "./totals";

export const metadata = { title: "Invoices & payments" };

const AGING_COLORS = ["#284CC7", "#D0691F", "#B42323", "#7F1D1D", "#450A0A"];

const SORTS = {
  newest: { label: "Newest first", order: [desc(Invoice.createdAt)] },
  oldest: { label: "Oldest first", order: [asc(Invoice.createdAt)] },
  issued: { label: "Issue date (newest)", order: [desc(Invoice.issueDate), desc(Invoice.createdAt)] },
  due: { label: "Due date (soonest)", order: [asc(Invoice.dueDate), desc(Invoice.createdAt)] },
  amountDesc: { label: "Amount (high → low)", order: [desc(Invoice.total), desc(Invoice.createdAt)] },
  amountAsc: { label: "Amount (low → high)", order: [asc(Invoice.total), desc(Invoice.createdAt)] },
} satisfies SortChoices<SQL[]>;

function exportHref(sp: SearchParams, format: string): string {
  const q = new URLSearchParams();
  for (const k of ["status", "client", "project", "from", "to", "q"]) {
    const v = param(sp, k);
    if (v) q.set(k, v);
  }
  q.set("type", "invoices");
  q.set("format", format);
  return `/invoices/export?${q.toString()}`;
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("invoices.view");
  const sp = await searchParams;
  const today = todayKey();
  const page = pageParam(sp);
  const sort = sortParam(sp, SORTS);
  const fy = fiscalRange(today);
  const month = monthRangeOf(today);

  // Restricted clients (FRS §3.2) are hidden from the list, the totals and the filter options, like the finance reports.
  const hidden = await hiddenClientIds(user);
  const scope = notHiddenClient(hidden, Invoice.client);
  const paymentScope = notHiddenClient(hidden, Payment.client);
  const filter = invoiceFilter(sp, today, hidden);
  const baseNoStatus = invoiceFilter({ ...sp, status: "" }, today, hidden);

  const [rows, total, allCount, bucketCounts, fyInvoiced, monthInvoiced, fyReceived, monthReceived, receivables, clients, projects] = await Promise.all([
    db()
      .select({
        _id: Invoice._id,
        invoiceNo: Invoice.invoiceNo,
        draftNo: Invoice.draftNo,
        client: Invoice.client,
        project: Invoice.project,
        issueDate: Invoice.issueDate,
        dueDate: Invoice.dueDate,
        total: Invoice.total,
        balance: Invoice.balance,
        status: Invoice.status,
        items: Invoice.items,
      })
      .from(Invoice)
      .where(filter)
      .orderBy(...sort.order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(Invoice, filter),
    db().$count(Invoice, baseNoStatus),
    Promise.all(INVOICE_BUCKETS.map((b) => db().$count(Invoice, and(baseNoStatus, bucketFilter(b, today))))),
    invoicedBetween(fy.from, fy.to, scope),
    invoicedBetween(month.from, month.to, scope),
    receivedBetween(fy.from, fy.to, paymentScope),
    receivedBetween(month.from, month.to, paymentScope),
    loadReceivables(today, scope),
    db().select({ _id: Client._id, name: Client.name }).from(Client).where(clientScope(user)).orderBy(asc(Client.name)).limit(1000),
    db().select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title }).from(Project).where(isNotNull(Project.client)).orderBy(desc(Project.createdAt)).limit(500),
  ]);

  const clientName = new Map(clients.map((c) => [c._id, c.name]));
  const projectNo = new Map(projects.map((p) => [p._id, p.projectNo]));

  const outstanding = receivables.reduce((s, r) => s + r.balance, 0);
  const overdue = receivables.filter((r) => r.daysPastDue > 0);
  const overdueAmount = overdue.reduce((s, r) => s + r.balance, 0);
  const oldest = overdue.reduce((m, r) => Math.max(m, r.daysPastDue), 0);
  const aging = AGING_BUCKETS.map((b, i) => ({ ...b, color: AGING_COLORS[i], amount: receivables.filter((r) => r.bucket === b.key).reduce((s, r) => s + r.balance, 0) }));
  const agingTotal = aging.reduce((s, a) => s + a.amount, 0);

  const manage = can(user, "invoices.manage");
  const hasFilters = ["status", "client", "project", "from", "to", "q"].some((k) => param(sp, k));

  return (
    <PageBody>
      <PageHeader
        overline="Finance"
        title="Invoices & payments"
        actions={
          <>
            <Menu
              label="Export invoices"
              align="end"
              trigger={
                <button type="button" className={buttonClass("secondary")}>
                  <Download className="size-4" aria-hidden /> Export
                </button>
              }
              items={[
                { label: "CSV", href: exportHref(sp, "csv"), external: true },
                { label: "Excel", href: exportHref(sp, "xlsx"), external: true },
                { label: "PDF", href: exportHref(sp, "pdf"), external: true },
              ]}
            />
            {manage && (
              <ButtonLink href="/invoices/new" icon={<Plus className="size-4" aria-hidden />}>
                New invoice
              </ButtonLink>
            )}
          </>
        }
      />

      <LinkTabs
        items={[
          { href: "/invoices", label: "Invoices", active: true },
          { href: "/invoices/receivables", label: "Receivables" },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Invoiced · FY ${fy.label}`} value={inr(fyInvoiced.amount)} sub={`${inr(monthInvoiced.amount)} this month · ${plural(monthInvoiced.count, "invoice")}`} />
        <StatCard label={`Received · FY ${fy.label}`} value={<span className="text-success">{inr(fyReceived.amount)}</span>} sub={`${inr(monthReceived.amount)} this month · ${plural(monthReceived.count, "payment")}`} />
        <StatCard label="Outstanding receivables" value={inr(outstanding)} sub={`${plural(receivables.length, "invoice")} · ${plural(new Set(receivables.map((r) => r.client)).size, "client")}`} href="/invoices/receivables" />
        <StatCard
          label="Overdue"
          value={inr(overdueAmount)}
          tone={overdue.length > 0 ? "alert" : "default"}
          sub={overdue.length > 0 ? `${plural(overdue.length, "invoice")} · oldest ${plural(oldest, "day")}` : "Nothing overdue"}
          href="/invoices?status=overdue"
        />
      </div>

      {agingTotal > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-ink">Receivables ageing</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              {aging
                .filter((a) => a.amount > 0)
                .map((a) => (
                  <li key={a.key} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px]" style={{ background: a.color }} aria-hidden />
                    {a.label} {inr(a.amount)}
                  </li>
                ))}
            </ul>
          </div>
          <div className="flex h-3.5 gap-0.5 overflow-hidden rounded" role="img" aria-label="Receivables ageing by days past due">
            {aging
              .filter((a) => a.amount > 0)
              .map((a) => (
                <span key={a.key} title={`${a.label} ${inr(a.amount)}`} style={{ flex: a.amount, background: a.color }} />
              ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-line-soft p-4">
          <ChipFilters
            param="status"
            allLabel="All"
            options={INVOICE_BUCKETS.map((b, i) => ({ value: b, label: statusLabel("invoice", b), count: bucketCounts[i] }))}
          />
          <FilterBar>
            <SearchInput placeholder="Search invoice number…" />
            <SelectFilter param="client" allLabel="All clients" label="Client" options={clients.map((c) => ({ value: c._id, label: c.name }))} className="w-44" />
            <SelectFilter param="project" allLabel="All projects" label="Project" options={projects.map((p) => ({ value: p._id, label: `${p.projectNo} · ${p.title}` }))} className="w-44" />
            <DateFilter param="from" label="Issued from" />
            <DateFilter param="to" label="to" />
            <SortSelect options={sort.options} />
            <ClearFilters />
          </FilterBar>
          {hasFilters && (
            <p className="text-xs text-muted">
              {plural(total, "invoice")} match these filters (of {allCount} in total)
            </p>
          )}
        </div>
        <TableWrap phone={[1, 5, 7]} tablet={[1, 2, 5, 6, 7]}>
          <THead>
            <Th>Invoice</Th>
            <Th>Client · reference</Th>
            <Th>Issued</Th>
            <Th>Due</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Balance</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && (
              <EmptyRow colSpan={7}>
                {hasFilters ? "No invoices match these filters." : manage ? "No invoices yet. Create the first one with “New invoice”." : "No invoices yet."}
              </EmptyRow>
            )}
            {rows.map((r) => {
              const status = effectiveStatus(r, today);
              const isOverdue = status === "overdue";
              const ref = [r.items[0]?.description, r.project ? projectNo.get(r.project) : undefined].filter(Boolean).join(" · ");
              return (
                <Tr key={r._id}>
                  <Td>
                    <Link href={`/invoices/${r._id}`} className="font-mono text-xs font-semibold text-brand-600 hover:text-brand-800">
                      {r.invoiceNo ?? r.draftNo}
                    </Link>
                  </Td>
                  <Td>
                    <div className="font-semibold">{clientName.get(r.client) ?? "Unknown client"}</div>
                    {ref && <div className="max-w-xs truncate text-xs text-muted">{ref}</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{r.status === "draft" ? "—" : fmtDate(r.issueDate)}</Td>
                  <Td className={cn("whitespace-nowrap", isOverdue ? "font-semibold text-danger" : "text-ink-2")}>{r.status === "draft" || r.status === "cancelled" ? "—" : fmtDate(r.dueDate)}</Td>
                  <Td align="right">{inr(r.total)}</Td>
                  <Td align="right" className="font-semibold">
                    {r.status === "draft" || r.status === "cancelled" || r.balance <= 0 ? "—" : inr(r.balance)}
                  </Td>
                  <Td>
                    <StatusChip domain="invoice" value={status} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </PageBody>
  );
}
