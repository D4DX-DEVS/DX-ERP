import Link from "next/link";
import { forbidden } from "next/navigation";
import { Download } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Payment } from "@/lib/models";
import { idParam, type SearchParams } from "@/lib/query";
import { inr, plural } from "@/lib/format";
import { fmtDate, todayKey } from "@/lib/time";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/chip";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { Menu } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { hiddenClientIds, notHiddenClient } from "@/app/(app)/crm/_lib/access";
import { AGING_BUCKETS, clientNames, loadReceivables, type AgingKey } from "../data";
import { effectiveStatus } from "../totals";

export const metadata = { title: "Receivables" };

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("invoices.view");
  const sp = await searchParams;
  await connectDB();
  const today = todayKey();
  const selected = idParam(sp, "client");
  const hidden = await hiddenClientIds(user);
  if (selected && hidden.some((h) => h.toString() === selected)) forbidden();

  const receivables = await loadReceivables(today, notHiddenClient(hidden));
  const names = await clientNames(receivables.map((r) => r.client).concat(selected ? [selected] : []));

  const byClient = new Map<string, { client: string; count: number; total: number; oldest: number; buckets: Record<AgingKey, number> }>();
  for (const r of receivables) {
    const row = byClient.get(r.client) ?? { client: r.client, count: 0, total: 0, oldest: 0, buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 } };
    row.count += 1;
    row.total += r.balance;
    row.oldest = Math.max(row.oldest, r.daysPastDue);
    row.buckets[r.bucket] += r.balance;
    byClient.set(r.client, row);
  }
  const rows = [...byClient.values()].sort((a, b) => b.total - a.total);
  const totals = AGING_BUCKETS.map((b) => ({ ...b, amount: receivables.filter((r) => r.bucket === b.key).reduce((s, r) => s + r.balance, 0) }));
  const outstanding = receivables.reduce((s, r) => s + r.balance, 0);
  const overdue = receivables.filter((r) => r.daysPastDue > 0);
  const oldest = overdue.reduce((m, r) => Math.max(m, r.daysPastDue), 0);

  // Drill-down for one client: open invoices and the full payment history.
  const clientInvoices = selected ? receivables.filter((r) => r.client === selected) : [];
  const history = selected ? await Payment.find({ client: selected }).sort({ date: -1, createdAt: -1 }).limit(100).lean() : [];

  const exportItems = (["csv", "xlsx", "pdf"] as const).map((f) => ({ label: f === "csv" ? "CSV" : f === "xlsx" ? "Excel" : "PDF", href: `/invoices/export?type=receivables&format=${f}`, external: true }));

  return (
    <PageBody>
      <PageHeader
        overline="Finance"
        title="Receivables"
        description="Money still owed by clients, grouped by how many days past the due date it is."
        actions={
          <Menu
            label="Export receivables"
            trigger={
              <button type="button" className={buttonClass("secondary")}>
                <Download className="size-4" aria-hidden /> Export
              </button>
            }
            items={exportItems}
          />
        }
      />
      <LinkTabs
        items={[
          { href: "/invoices", label: "Invoices" },
          { href: "/invoices/receivables", label: "Receivables", active: true },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Outstanding" value={inr(outstanding)} sub={`${plural(receivables.length, "invoice")} · ${plural(rows.length, "client")}`} />
        <StatCard label="Not yet due" value={inr(totals[0].amount)} sub="Within payment terms" />
        <StatCard label="Overdue" value={inr(outstanding - totals[0].amount)} tone={overdue.length ? "alert" : "default"} sub={overdue.length ? `${plural(overdue.length, "invoice")} · oldest ${plural(oldest, "day")}` : "Nothing overdue"} />
        <StatCard label="90+ days overdue" value={inr(totals[4].amount)} tone={totals[4].amount > 0 ? "alert" : "default"} sub="Needs follow-up" />
      </div>

      <Card>
        <CardHeader title="Client-wise outstanding" subtitle="Select a client to see their open invoices and payment history." />
        <TableWrap tablet={[1, 2, 3, 4]}>
          <THead>
            <Th>Client</Th>
            <Th align="right">Invoices</Th>
            {AGING_BUCKETS.map((b) => (
              <Th key={b.key} align="right">
                {b.label}
              </Th>
            ))}
            <Th align="right">Outstanding</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No outstanding invoices. Everything issued has been paid.</EmptyRow>}
            {rows.map((r) => (
              <Tr key={r.client} className={cn(selected === r.client && "bg-brand-50 hover:bg-brand-50")}>
                <Td>
                  <Link href={`/invoices/receivables?client=${r.client}`} scroll={false} className="font-semibold text-ink hover:text-brand-600" aria-current={selected === r.client ? "true" : undefined}>
                    {names.get(r.client)?.name ?? "Unknown client"}
                  </Link>
                  {names.get(r.client) && <div className="text-xs text-muted">{names.get(r.client)?.clientNo}</div>}
                </Td>
                <Td align="right">{r.count}</Td>
                {AGING_BUCKETS.map((b) => (
                  <Td key={b.key} align="right" className={cn(r.buckets[b.key] === 0 && "text-subtle", b.key !== "current" && r.buckets[b.key] > 0 && "font-semibold text-danger")}>
                    {r.buckets[b.key] ? inr(r.buckets[b.key]) : "—"}
                  </Td>
                ))}
                <Td align="right" className="font-bold">
                  {inr(r.total)}
                </Td>
              </Tr>
            ))}
            {rows.length > 0 && (
              <Tr className="bg-field font-semibold hover:bg-field">
                <Td>Total</Td>
                <Td align="right">{receivables.length}</Td>
                {totals.map((t) => (
                  <Td key={t.key} align="right">
                    {inr(t.amount)}
                  </Td>
                ))}
                <Td align="right">{inr(outstanding)}</Td>
              </Tr>
            )}
          </tbody>
        </TableWrap>
      </Card>

      {selected && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={`Open invoices · ${names.get(selected)?.name ?? "Client"}`} href="/invoices/receivables" hrefLabel="Close" />
            <TableWrap phone={[1, 3, 4]} tablet={[1, 2, 3, 4]}>
              <THead>
                <Th>Invoice</Th>
                <Th>Due</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
              </THead>
              <tbody>
                {clientInvoices.length === 0 && <EmptyRow colSpan={4}>No open invoices for this client.</EmptyRow>}
                {clientInvoices.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/invoices/${r.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:text-brand-800">
                        {r.invoiceNo}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {fmtDate(r.dueDate)}
                      {r.daysPastDue > 0 && <div className="text-xs font-semibold text-danger">{plural(r.daysPastDue, "day")} late</div>}
                    </Td>
                    <Td align="right" className="font-semibold">
                      {inr(r.balance, true)}
                    </Td>
                    <Td>
                      <StatusChip domain="invoice" value={effectiveStatus({ status: r.status, dueDate: r.dueDate, balance: r.balance }, today)} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <Card>
            <CardHeader title="Payment history" subtitle="Latest 100 payments, refunds and adjustments" />
            <TableWrap phone={[1, 4]} tablet={[1, 2, 3, 4]}>
              <THead>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Method · reference</Th>
                <Th align="right">Amount</Th>
              </THead>
              <tbody>
                {history.length === 0 && <EmptyRow colSpan={4}>No payments recorded for this client yet.</EmptyRow>}
                {history.map((p) => (
                  <Tr key={p._id.toString()}>
                    <Td className="whitespace-nowrap">{fmtDate(p.date)}</Td>
                    <Td>
                      <StatusChip domain="payment" value={p.type} size="sm" />
                    </Td>
                    <Td>
                      <Link href={`/invoices/${p.invoice}`} className="font-medium text-brand-600 hover:text-brand-800">
                        {p.method}
                      </Link>
                      {p.reference && <div className="text-xs text-muted">{p.reference}</div>}
                    </Td>
                    <Td align="right" className={cn("font-semibold", p.type === "refund" && "text-danger")}>
                      {p.type === "refund" ? "−" : ""}
                      {inr(p.amount, true)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      )}
    </PageBody>
  );
}
