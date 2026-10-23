import "server-only";
import { and, eq, gt, gte, isNull, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { Client, Expense, Invoice, PayrollRun, User } from "@/lib/models";
import { usersWithPermission } from "@/lib/notify";
import { inr } from "@/lib/format";
import { inList } from "@/lib/sql";
import { addDays, diffDays, fmtDate, todayKey } from "@/lib/time";
import { KIND_LABEL, periodLabel } from "@/lib/payroll/constants";
import { notifyBatch } from "./batch";
import type { Job } from "./registry";

const DAY_MS = 86_400_000;

interface ClientInfo {
  name: string;
  owner?: string;
  confidential: boolean;
}

/** Client names and owners; an owner is only kept when they may open invoices (otherwise the link would be a 403). */
async function clientNameAndOwner(clientIds: string[]): Promise<Map<string, ClientInfo>> {
  const [rows, viewers] = await Promise.all([
    db()
      .select({ id: Client._id, name: Client.name, owner: Client.owner, confidential: Client.confidential })
      .from(Client)
      .where(inList(Client._id, [...new Set(clientIds)])),
    usersWithPermission("invoices.view"),
  ]);
  const allowed = new Set(viewers);
  return new Map(rows.map((c) => [c.id, { name: c.name, owner: c.owner && allowed.has(c.owner) ? c.owner : undefined, confidential: c.confidential }]));
}

/** Invoice reminders for a restricted client (FRS §3.2) go only to managers who may see it, plus its owner. */
async function invoiceRecipients(managers: string[], clients: Map<string, ClientInfo>): Promise<(client?: ClientInfo) => (string | undefined)[]> {
  const privileged = new Set([...clients.values()].some((c) => c.confidential) ? await usersWithPermission("crm.confidential") : []);
  return (client) => (client?.confidential ? [...managers.filter((m) => privileged.has(m)), client.owner] : [...managers, client?.owner]);
}

/** Issued / partially paid invoices past their due date become "overdue"; finance and the client owner hear once. */
async function flagOverdueInvoices(): Promise<string> {
  const today = todayKey();
  const late = await db()
    .select({ id: Invoice._id, invoiceNo: Invoice.invoiceNo, draftNo: Invoice.draftNo, client: Invoice.client, balance: Invoice.balance, dueDate: Invoice.dueDate, overdueNotifiedAt: Invoice.overdueNotifiedAt })
    .from(Invoice)
    .where(and(inList(Invoice.status, ["issued", "partially_paid"]), lt(Invoice.dueDate, today), gt(Invoice.balance, 0)));
  if (late.length === 0) return "no overdue invoices";
  await db()
    .update(Invoice)
    .set({ status: "overdue" })
    .where(and(inList(Invoice._id, late.map((i) => i.id)), inList(Invoice.status, ["issued", "partially_paid"])));

  const toNotify = late.filter((i) => !i.overdueNotifiedAt);
  if (toNotify.length === 0) return `${late.length} overdue, none new`;
  const [managers, clients] = await Promise.all([usersWithPermission("invoices.manage"), clientNameAndOwner(toNotify.map((i) => i.client))]);
  const recipientsOf = await invoiceRecipients(managers, clients);
  await notifyBatch(
    toNotify.map((inv) => {
      const client = clients.get(inv.client);
      const no = inv.invoiceNo ?? inv.draftNo;
      return {
        recipients: recipientsOf(client),
        input: {
          type: "invoice",
          title: `Invoice ${no} is overdue`,
          body: `${client?.name ?? "Client"} · ${inr(inv.balance, true)} was due on ${fmtDate(inv.dueDate)} (${diffDays(inv.dueDate, today)} days ago)`,
          link: `/invoices/${inv.id}`,
          priority: "high" as const,
          dedupeKey: `invoice-overdue:${inv.id}`,
        },
      };
    }),
  );
  await db()
    .update(Invoice)
    .set({ overdueNotifiedAt: new Date() })
    .where(and(inList(Invoice._id, toNotify.map((i) => i.id)), isNull(Invoice.overdueNotifiedAt)));
  return `${late.length} overdue, ${toNotify.length} notified`;
}

/** Invoices falling due within three days get one reminder. */
async function remindInvoicesDueSoon(): Promise<string> {
  const today = todayKey();
  const soon = await db()
    .select({ id: Invoice._id, invoiceNo: Invoice.invoiceNo, draftNo: Invoice.draftNo, client: Invoice.client, balance: Invoice.balance, dueDate: Invoice.dueDate })
    .from(Invoice)
    .where(and(inList(Invoice.status, ["issued", "partially_paid"]), gt(Invoice.balance, 0), gte(Invoice.dueDate, today), lte(Invoice.dueDate, addDays(today, 3)), isNull(Invoice.dueReminderSentAt)));
  if (soon.length === 0) return "none due soon";
  const [managers, clients] = await Promise.all([usersWithPermission("invoices.manage"), clientNameAndOwner(soon.map((i) => i.client))]);
  const recipientsOf = await invoiceRecipients(managers, clients);
  await notifyBatch(
    soon.map((inv) => {
      const client = clients.get(inv.client);
      const days = diffDays(today, inv.dueDate);
      return {
        recipients: recipientsOf(client),
        input: {
          type: "invoice",
          title: `Invoice ${inv.invoiceNo ?? inv.draftNo} is due ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}`,
          body: `${client?.name ?? "Client"} · balance ${inr(inv.balance, true)} · due ${fmtDate(inv.dueDate)}`,
          link: `/invoices/${inv.id}`,
          dedupeKey: `invoice-due:${inv.id}`,
        },
      };
    }),
  );
  await db()
    .update(Invoice)
    .set({ dueReminderSentAt: new Date() })
    .where(and(inList(Invoice._id, soon.map((i) => i.id)), isNull(Invoice.dueReminderSentAt)));
  return `${soon.length} reminders`;
}

/** Expenses that have waited more than two days for a decision are pushed to the approvers (once per expense). */
async function remindStaleExpenses(): Promise<string> {
  const stale = await db()
    .select({ id: Expense._id, expenseNo: Expense.expenseNo, user: Expense.user, amount: Expense.amount, category: Expense.category })
    .from(Expense)
    .where(and(eq(Expense.status, "submitted"), lt(Expense.submittedAt, new Date(Date.now() - 2 * DAY_MS))));
  if (stale.length === 0) return "no stale expenses";
  const [approvers, people] = await Promise.all([
    usersWithPermission("expenses.approve"),
    db()
      .select({ id: User._id, name: User.name })
      .from(User)
      .where(inList(User._id, [...new Set(stale.map((e) => e.user))])),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  await notifyBatch(
    stale.map((e) => ({
      recipients: approvers,
      exclude: [e.user],
      input: {
        type: "expense",
        title: `Expense ${e.expenseNo} has been waiting for approval`,
        body: `${names.get(e.user) ?? "Someone"} · ${inr(e.amount, true)} · ${e.category}`,
        link: `/expenses/${e.id}`,
        actionable: true,
        dedupeKey: `expense-stale:${e.id}`,
      },
    })),
  );
  return `${stale.length} expenses`;
}

/** A run verified more than a day ago and still not approved is flagged to approvers, at most once a day. */
async function remindStalePayroll(): Promise<string> {
  const today = todayKey();
  const stale = await db()
    .select({ id: PayrollRun._id, runNo: PayrollRun.runNo, kind: PayrollRun.kind, period: PayrollRun.period, totals: PayrollRun.totals })
    .from(PayrollRun)
    .where(and(eq(PayrollRun.status, "verified"), lt(PayrollRun.verifiedAt, new Date(Date.now() - DAY_MS))));
  if (stale.length === 0) return "no runs waiting";
  const approvers = await usersWithPermission("payroll.approve");
  await notifyBatch(
    stale.map((run) => ({
      recipients: approvers,
      input: {
        type: "payroll",
        title: `${KIND_LABEL[run.kind]} run for ${periodLabel(run.period)} is still waiting for approval`,
        body: `${run.runNo} · ${run.totals.count} payslips · net ${inr(run.totals.net)}`,
        link: `/payroll/${run.id}`,
        actionable: true,
        priority: "high" as const,
        dedupeKey: `payroll-approval:${run.id}:${today}`,
      },
    })),
  );
  return `${stale.length} runs`;
}

export const financeJobs: Job[] = [
  { name: "finance-invoice-overdue", intervalMinutes: 60, run: flagOverdueInvoices },
  { name: "finance-invoice-due-soon", intervalMinutes: 180, run: remindInvoicesDueSoon },
  { name: "finance-expense-approval-reminder", intervalMinutes: 240, run: remindStaleExpenses },
  { name: "finance-payroll-approval-reminder", intervalMinutes: 120, run: remindStalePayroll },
];
