import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Client, Invoice, Payment } from "@/lib/models";
import type { InvoiceStatus } from "@/lib/models";
import { dateParam, idParam, param, searchRegex, type SearchParams } from "@/lib/query";
import { diffDays, monthKey, zonedDateTime } from "@/lib/time";
import { fiscalYear } from "@/lib/counters";

export type InvoiceBucket = "draft" | "issued" | "partially_paid" | "overdue" | "paid" | "cancelled";

export const INVOICE_BUCKETS: InvoiceBucket[] = ["draft", "issued", "partially_paid", "overdue", "paid", "cancelled"];

export function isBucket(value: string): value is InvoiceBucket {
  return (INVOICE_BUCKETS as string[]).includes(value);
}

/** Mongo filter for a displayed status. Overdue includes unpaid invoices past due that the job has not flagged yet. */
export function bucketFilter(bucket: InvoiceBucket, today: string): Record<string, unknown> {
  switch (bucket) {
    case "overdue":
      return { $or: [{ status: "overdue" }, { status: { $in: ["issued", "partially_paid"] }, dueDate: { $lt: today } }] };
    case "issued":
    case "partially_paid":
      return { status: bucket, dueDate: { $gte: today } };
    default:
      return { status: bucket };
  }
}

/** Invoice list filter from the URL (status chip, client, project, issue-date range, search); `hidden` = restricted clients the viewer may not see. */
export function invoiceFilter(sp: SearchParams, today: string, hidden: Types.ObjectId[] = []): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (hidden.length) and.push({ client: { $nin: hidden } });
  const status = param(sp, "status");
  if (isBucket(status)) and.push(bucketFilter(status, today));
  const client = idParam(sp, "client");
  if (client) and.push({ client });
  const project = idParam(sp, "project");
  if (project) and.push({ project });
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");
  if (from) and.push({ issueDate: { $gte: from } });
  if (to) and.push({ issueDate: { $lte: to } });
  const q = searchRegex(param(sp, "q"));
  if (q) and.push({ $or: [{ invoiceNo: q }, { draftNo: q }] });
  return and.length ? { $and: and } : {};
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
export async function loadReceivables(today: string, extra: Record<string, unknown> = {}): Promise<Receivable[]> {
  await connectDB();
  const rows = await Invoice.find(
    { status: { $in: ["issued", "partially_paid", "overdue"] }, balance: { $gt: 0 }, ...extra },
    { invoiceNo: 1, client: 1, project: 1, issueDate: 1, dueDate: 1, total: 1, balance: 1, status: 1 },
  )
    .sort({ dueDate: 1 })
    .lean();
  return rows.map((r) => {
    const daysPastDue = diffDays(r.dueDate, today);
    return {
      id: r._id.toString(),
      invoiceNo: r.invoiceNo ?? "",
      client: r.client.toString(),
      project: r.project?.toString(),
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
  await connectDB();
  const rows = await Client.find({ _id: { $in: unique } }, { name: 1, clientNo: 1 }).lean();
  return new Map(rows.map((c) => [c._id.toString(), { name: c.name, clientNo: c.clientNo }]));
}

/** Invoiced totals (issued, partially paid, paid, overdue — not drafts or cancelled) with issue date in a range. */
export async function invoicedBetween(from: string, to: string, extra: Record<string, unknown> = {}): Promise<{ amount: number; count: number }> {
  await connectDB();
  const [row] = await Invoice.aggregate<{ amount: number; count: number }>([
    { $match: { status: { $in: ["issued", "partially_paid", "paid", "overdue"] }, issueDate: { $gte: from, $lte: to }, ...extra } },
    { $group: { _id: null, amount: { $sum: "$total" }, count: { $sum: 1 } } },
  ]);
  return { amount: row?.amount ?? 0, count: row?.count ?? 0 };
}

/** Money received in a date range: payments minus refunds (adjustments are write-offs, not receipts). */
export async function receivedBetween(from: string, to: string, extra: Record<string, unknown> = {}): Promise<{ amount: number; count: number }> {
  await connectDB();
  const rows = await Payment.aggregate<{ _id: string; amount: number; count: number }>([
    { $match: { type: { $in: ["payment", "refund"] }, date: { $gte: from, $lte: to }, ...extra } },
    { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const paid = rows.find((r) => r._id === "payment");
  const refunded = rows.find((r) => r._id === "refund");
  return { amount: (paid?.amount ?? 0) - (refunded?.amount ?? 0), count: paid?.count ?? 0 };
}
