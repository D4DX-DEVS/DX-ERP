import "server-only";
import { and, asc, eq, gt, gte, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { Client, Invoice, Payment, type Id } from "@/lib/models";
import type { InvoiceStatus } from "@/lib/models";
import { dateParam, idParam, param, type SearchParams } from "@/lib/query";
import { inList, searchAny } from "@/lib/sql";
import { diffDays, monthKey, zonedDateTime } from "@/lib/time";
import { fiscalYear } from "@/lib/counters";
import { notHiddenClient } from "@/app/(app)/crm/_lib/access";

export type InvoiceBucket = "draft" | "issued" | "partially_paid" | "overdue" | "paid" | "cancelled";

export const INVOICE_BUCKETS: InvoiceBucket[] = ["draft", "issued", "partially_paid", "overdue", "paid", "cancelled"];

export function isBucket(value: string): value is InvoiceBucket {
  return (INVOICE_BUCKETS as string[]).includes(value);
}

/** SQL condition for a displayed status. Overdue includes unpaid invoices past due that the job has not flagged yet. */
export function bucketFilter(bucket: InvoiceBucket, today: string): SQL | undefined {
  switch (bucket) {
    case "overdue":
      return or(eq(Invoice.status, "overdue"), and(inList(Invoice.status, ["issued", "partially_paid"]), lt(Invoice.dueDate, today)));
    case "issued":
    case "partially_paid":
      return and(eq(Invoice.status, bucket), gte(Invoice.dueDate, today));
    default:
      return eq(Invoice.status, bucket);
  }
}

/** Invoice list filter from the URL (status chip, client, project, issue-date range, search); `hidden` = restricted clients the viewer may not see. */
export function invoiceFilter(sp: SearchParams, today: string, hidden: Id[] = []): SQL | undefined {
  const status = param(sp, "status");
  const client = idParam(sp, "client");
  const project = idParam(sp, "project");
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");
  return and(
    notHiddenClient(hidden, Invoice.client),
    isBucket(status) ? bucketFilter(status, today) : undefined,
    client ? eq(Invoice.client, client) : undefined,
    project ? eq(Invoice.project, project) : undefined,
    from ? gte(Invoice.issueDate, from) : undefined,
    to ? lte(Invoice.issueDate, to) : undefined,
    searchAny(param(sp, "q"), Invoice.invoiceNo, Invoice.draftNo),
  );
}

/** First and last day of the fiscal year (April–March) containing today, e.g. 2026-04-01 … 2027-03-31. */
export function fiscalRange(today: string): { label: string; from: string; to: string } {
  const label = fiscalYear(zonedDateTime(today, "12:00"));
  const startYear = Number(label.slice(0, 4));
  return { label, from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

export function monthRangeOf(today: string): { from: string; to: string; key: string } {
  const key = monthKey(zonedDateTime(today, "12:00"));
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { key, from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

export const AGING_BUCKETS = [
  { key: "current", label: "Not due" },
  { key: "d30", label: "1–30 days" },
  { key: "d60", label: "31–60 days" },
  { key: "d90", label: "61–90 days" },
  { key: "d90plus", label: "90+ days" },
] as const;

export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

export function agingKey(daysPastDue: number): AgingKey {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d30";
  if (daysPastDue <= 60) return "d60";
  if (daysPastDue <= 90) return "d90";
  return "d90plus";
}

export interface Receivable {
  id: string;
  invoiceNo: string;
  client: string;
  project?: string;
  issueDate: string;
  dueDate: string;
  total: number;
  balance: number;
  status: InvoiceStatus;
  daysPastDue: number;
  bucket: AgingKey;
}

/** Issued, partially paid and overdue invoices with money still owed. */
export async function loadReceivables(today: string, extra?: SQL): Promise<Receivable[]> {
  const rows = await db()
    .select({
      _id: Invoice._id,
      invoiceNo: Invoice.invoiceNo,
      client: Invoice.client,
      project: Invoice.project,
      issueDate: Invoice.issueDate,
      dueDate: Invoice.dueDate,
      total: Invoice.total,
      balance: Invoice.balance,
      status: Invoice.status,
    })
    .from(Invoice)
    .where(and(inList(Invoice.status, ["issued", "partially_paid", "overdue"]), gt(Invoice.balance, 0), extra))
    .orderBy(asc(Invoice.dueDate));
  return rows.map((r) => {
    const daysPastDue = diffDays(r.dueDate, today);
    return {
      id: r._id,
      invoiceNo: r.invoiceNo ?? "",
      client: r.client,
      project: r.project ?? undefined,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      total: r.total,
      balance: r.balance,
      status: r.status,
      daysPastDue,
      bucket: agingKey(daysPastDue),
    };
  });
}

export async function clientNames(ids: string[]): Promise<Map<string, { name: string; clientNo: string }>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db().select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo }).from(Client).where(inList(Client._id, unique));
  return new Map(rows.map((c) => [c._id, { name: c.name, clientNo: c.clientNo }]));
}

/** Invoiced totals (issued, partially paid, paid, overdue — not drafts or cancelled) with issue date in a range. */
export async function invoicedBetween(from: string, to: string, extra?: SQL): Promise<{ amount: number; count: number }> {
  const [row] = await db()
    .select({ amount: sql<number>`coalesce(sum(${Invoice.total}), 0)`.mapWith(Number), count: sql<number>`count(*)`.mapWith(Number) })
    .from(Invoice)
    .where(and(inList(Invoice.status, ["issued", "partially_paid", "paid", "overdue"]), gte(Invoice.issueDate, from), lte(Invoice.issueDate, to), extra));
  return { amount: row?.amount ?? 0, count: row?.count ?? 0 };
}

/** Money received in a date range: payments minus refunds (adjustments are write-offs, not receipts). */
export async function receivedBetween(from: string, to: string, extra?: SQL): Promise<{ amount: number; count: number }> {
  const rows = await db()
    .select({ type: Payment.type, amount: sql<number>`coalesce(sum(${Payment.amount}), 0)`.mapWith(Number), count: sql<number>`count(*)`.mapWith(Number) })
    .from(Payment)
    .where(and(inList(Payment.type, ["payment", "refund"]), gte(Payment.date, from), lte(Payment.date, to), extra))
    .groupBy(Payment.type);
  const paid = rows.find((r) => r.type === "payment");
  const refunded = rows.find((r) => r.type === "refund");
  return { amount: (paid?.amount ?? 0) - (refunded?.amount ?? 0), count: paid?.count ?? 0 };
}
