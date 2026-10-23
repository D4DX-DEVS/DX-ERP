import "server-only";
import { connectDB } from "@/lib/db";
import { Client, Expense, Invoice, PayrollRun, User } from "@/lib/models";
import { notify, usersWithPermission } from "@/lib/notify";
import { inr } from "@/lib/format";
import { addDays, diffDays, fmtDate, todayKey } from "@/lib/time";
import { KIND_LABEL, periodLabel } from "@/lib/payroll/constants";
import type { Job } from "./registry";

const DAY_MS = 86_400_000;

/** Client names and owners; an owner is only kept when they may open invoices (otherwise the link would be a 403). */
async function clientNameAndOwner(clientIds: string[]): Promise<Map<string, { name: string; owner?: string; confidential: boolean }>> {
  const [rows, viewers] = await Promise.all([Client.find({ _id: { $in: clientIds } }, { name: 1, owner: 1, confidential: 1 }).lean(), usersWithPermission("invoices.view")]);
  const allowed = new Set(viewers);
  return new Map(rows.map((c) => [c._id.toString(), { name: c.name, owner: c.owner && allowed.has(c.owner.toString()) ? c.owner.toString() : undefined, confidential: Boolean(c.confidential) }]));
}

/** Invoice reminders for a restricted client (FRS §3.2) go only to managers who may see it, plus its owner. */
async function invoiceRecipients(managers: string[], client?: { owner?: string; confidential: boolean }): Promise<(string | undefined)[]> {
  if (!client?.confidential) return [...managers, client?.owner];
  const privileged = new Set(await usersWithPermission("crm.confidential"));
  return [...managers.filter((m) => privileged.has(m)), client.owner];
}

/** Issued / partially paid invoices past their due date become "overdue"; finance and the client owner hear once. */
async function flagOverdueInvoices(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const late = await Invoice.find({ status: { $in: ["issued", "partially_paid"] }, dueDate: { $lt: today }, balance: { $gt: 0 } }, { invoiceNo: 1, draftNo: 1, client: 1, balance: 1, dueDate: 1, overdueNotifiedAt: 1 }).lean();
  if (late.length === 0) return "no overdue invoices";
  await Invoice.updateMany({ _id: { $in: late.map((i) => i._id) }, status: { $in: ["issued", "partially_paid"] } }, { $set: { status: "overdue" } });

  const toNotify = late.filter((i) => !i.overdueNotifiedAt);
  if (toNotify.length === 0) return `${late.length} overdue, none new`;
  const [managers, clients] = await Promise.all([usersWithPermission("invoices.manage"), clientNameAndOwner(toNotify.map((i) => i.client.toString()))]);
  for (const inv of toNotify) {
    const client = clients.get(inv.client.toString());
    const no = inv.invoiceNo ?? inv.draftNo;
    await notify(await invoiceRecipients(managers, client), {
      type: "invoice",
      title: `Invoice ${no} is overdue`,
      body: `${client?.name ?? "Client"} · ${inr(inv.balance, true)} was due on ${fmtDate(inv.dueDate)} (${diffDays(inv.dueDate, today)} days ago)`,
      link: `/invoices/${inv._id}`,
      priority: "high",
      dedupeKey: `invoice-overdue:${inv._id}`,
    });
    await Invoice.updateOne({ _id: inv._id, overdueNotifiedAt: null }, { $set: { overdueNotifiedAt: new Date() } });
  }
  return `${late.length} overdue, ${toNotify.length} notified`;
}

/** Invoices falling due within three days get one reminder. */
async function remindInvoicesDueSoon(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const soon = await Invoice.find(
    { status: { $in: ["issued", "partially_paid"] }, balance: { $gt: 0 }, dueDate: { $gte: today, $lte: addDays(today, 3) }, dueReminderSentAt: null },
    { invoiceNo: 1, draftNo: 1, client: 1, balance: 1, dueDate: 1 },
  ).lean();
  if (soon.length === 0) return "none due soon";
  const [managers, clients] = await Promise.all([usersWithPermission("invoices.manage"), clientNameAndOwner(soon.map((i) => i.client.toString()))]);
  for (const inv of soon) {
    const client = clients.get(inv.client.toString());
    const days = diffDays(today, inv.dueDate);
    await notify(await invoiceRecipients(managers, client), {
      type: "invoice",
      title: `Invoice ${inv.invoiceNo ?? inv.draftNo} is due ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}`,
      body: `${client?.name ?? "Client"} · balance ${inr(inv.balance, true)} · due ${fmtDate(inv.dueDate)}`,
      link: `/invoices/${inv._id}`,
      dedupeKey: `invoice-due:${inv._id}`,
    });
    await Invoice.updateOne({ _id: inv._id, dueReminderSentAt: null }, { $set: { dueReminderSentAt: new Date() } });
  }
  return `${soon.length} reminders`;
}

/** Expenses that have waited more than two days for a decision are pushed to the approvers (once per expense). */
async function remindStaleExpenses(): Promise<string> {
  await connectDB();
  const stale = await Expense.find({ status: "submitted", submittedAt: { $lt: new Date(Date.now() - 2 * DAY_MS) } }, { expenseNo: 1, user: 1, amount: 1, category: 1 }).lean();
  if (stale.length === 0) return "no stale expenses";
  const [approvers, people] = await Promise.all([usersWithPermission("expenses.approve"), User.find({ _id: { $in: stale.map((e) => e.user) } }, { name: 1 }).lean()]);
  const names = new Map(people.map((p) => [p._id.toString(), p.name]));
  for (const e of stale) {
    await notify(
      approvers,
      {
        type: "expense",
        title: `Expense ${e.expenseNo} has been waiting for approval`,
        body: `${names.get(e.user.toString()) ?? "Someone"} · ${inr(e.amount, true)} · ${e.category}`,
        link: `/expenses/${e._id}`,
        actionable: true,
        dedupeKey: `expense-stale:${e._id}`,
      },
      [e.user],
    );
  }
  return `${stale.length} expenses`;
}

/** A run verified more than a day ago and still not approved is flagged to approvers, at most once a day. */
async function remindStalePayroll(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const stale = await PayrollRun.find({ status: "verified", verifiedAt: { $lt: new Date(Date.now() - DAY_MS) } }, { runNo: 1, kind: 1, period: 1, totals: 1 }).lean();
  if (stale.length === 0) return "no runs waiting";
  const approvers = await usersWithPermission("payroll.approve");
  for (const run of stale) {
    await notify(approvers, {
      type: "payroll",
      title: `${KIND_LABEL[run.kind]} run for ${periodLabel(run.period)} is still waiting for approval`,
      body: `${run.runNo} · ${run.totals.count} payslips · net ${inr(run.totals.net)}`,
      link: `/payroll/${run._id}`,
      actionable: true,
      priority: "high",
      dedupeKey: `payroll-approval:${run._id}:${today}`,
    });
  }
  return `${stale.length} runs`;
}

export const financeJobs: Job[] = [
  { name: "finance-invoice-overdue", intervalMinutes: 60, run: flagOverdueInvoices },
  { name: "finance-invoice-due-soon", intervalMinutes: 180, run: remindInvoicesDueSoon },
  { name: "finance-expense-approval-reminder", intervalMinutes: 240, run: remindStaleExpenses },
  { name: "finance-payroll-approval-reminder", intervalMinutes: 120, run: remindStalePayroll },
];
