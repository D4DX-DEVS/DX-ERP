import "server-only";
import { and, asc, count, desc, eq, gt, gte, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Asset, Department, Expense, Invoice, Payment, Project, type AssetStatus, type ExpenseStatus, type IInvoice, type InvoiceStatus, type PaymentType } from "@/lib/models";
import { inList, notInList } from "@/lib/sql";
import { getSettings } from "@/lib/settings";
import { optionLabel, statusLabel } from "@/lib/status";
import { addDays, addMonths, diffDays, fmtDate, todayKey } from "@/lib/time";
import { inr, round2, titleCase } from "@/lib/format";
import {
  clientNames,
  clientScope,
  DEFAULTS,
  DEPARTMENT_FILTER,
  hiddenClientIds,
  monthRangeOf,
  PERSON_FILTER,
  peopleMap,
  projectMap,
  rangeOf,
  RANGE_FILTERS,
  sumOf,
  userScope,
  type PersonInfo,
  type ProjectInfo,
} from "./shared";
import { defineReport, type ReportFilterDef } from "./types";
import { ASSET_KIND_LABELS, ASSET_KINDS, ASSET_STATUSES } from "@/app/(app)/assets/meta";

const FIN = ["reports.view", "reports.financial"] as const;

/** An issued invoice past its due date with money still owed is overdue, whatever status was last stored. */
function effectiveInvoiceStatus(i: Pick<IInvoice, "status" | "balance" | "dueDate">, today: string): string {
  return ["issued", "partially_paid"].includes(i.status) && i.balance > 0 && i.dueDate < today ? "overdue" : i.status;
}

const invoiceNumber = (i: Pick<IInvoice, "invoiceNo" | "draftNo">) => i.invoiceNo ?? i.draftNo;

/* --------------------------------------------------------- invoice & payment status */

interface InvoiceRow {
  number: string;
  client: string;
  project: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paid: number;
  refunded: number;
  balance: number;
  status: string;
  statusKey: string;
  daysOverdue: number;
}

const invoiceStatus = defineReport<InvoiceRow>({
  key: "invoice-status",
  title: "Invoice & payment status",
  group: "CRM & Finance",
  description: "Invoices issued in the period with amount, payments received, balance and overdue days.",
  permissions: [...FIN, "invoices.view"],
  filters: [
    ...RANGE_FILTERS.map((f) => (f.key === "from" ? { ...f, label: "Issued from" } : { ...f, label: "Issued to" })),
    { key: "status", label: "Status", type: "select", options: ["issued", "partially_paid", "paid", "overdue", "cancelled"].map((s) => ({ value: s, label: statusLabel("invoice", s) })) },
    { key: "client", label: "Client", type: "client" },
    { key: "project", label: "Project", type: "project" },
  ],
  async run(f, user) {
    const today = todayKey();
    const hidden = await hiddenClientIds(user);
    const { from, to } = rangeOf(f);
    const statusCond =
      f.status === "overdue"
        ? and(inList(Invoice.status, ["issued", "partially_paid", "overdue"]), lt(Invoice.dueDate, today), gt(Invoice.balance, 0))
        : f.status
          ? eq(Invoice.status, f.status as InvoiceStatus)
          : ne(Invoice.status, "draft");
    const docs = await db()
      .select({
        invoiceNo: Invoice.invoiceNo,
        draftNo: Invoice.draftNo,
        client: Invoice.client,
        project: Invoice.project,
        issueDate: Invoice.issueDate,
        dueDate: Invoice.dueDate,
        total: Invoice.total,
        amountPaid: Invoice.amountPaid,
        amountRefunded: Invoice.amountRefunded,
        balance: Invoice.balance,
        status: Invoice.status,
      })
      .from(Invoice)
      .where(and(gte(Invoice.issueDate, from), lte(Invoice.issueDate, to), statusCond, clientScope(f, hidden, Invoice.client), f.project ? eq(Invoice.project, f.project) : undefined))
      .orderBy(desc(Invoice.issueDate))
      .limit(20_000);
    const [clients, projects] = await Promise.all([clientNames(docs.map((d) => d.client), user), projectMap(docs.map((d) => d.project))]);
    const rows: InvoiceRow[] = docs.map((d) => {
      const status = effectiveInvoiceStatus(d, today);
      const project = d.project ? projects.get(d.project) : undefined;
      return {
        number: invoiceNumber(d),
        client: clients.get(d.client) ?? "",
        project: project ? `${project.projectNo} · ${project.title}` : "",
        issueDate: d.issueDate,
        dueDate: d.dueDate,
        total: d.total,
        paid: d.amountPaid,
        refunded: d.amountRefunded,
        balance: d.status === "cancelled" ? 0 : d.balance,
        status: statusLabel("invoice", status),
        statusKey: status,
        daysOverdue: status === "overdue" ? diffDays(d.dueDate, today) : 0,
      };
    });
    const live = rows.filter((r) => r.statusKey !== "cancelled");
    const sum = (list: InvoiceRow[], pick: (r: InvoiceRow) => number) => list.reduce((s, r) => s + pick(r), 0);
    return {
      columns: [
        { header: "Invoice", value: (r) => r.number },
        { header: "Client", value: (r) => r.client, width: 28 },
        { header: "Project", value: (r) => r.project, width: 30 },
        { header: "Issued", value: (r) => fmtDate(r.issueDate) },
        { header: "Due", value: (r) => fmtDate(r.dueDate) },
        { header: "Amount", value: (r) => r.total, type: "money" },
        { header: "Received", value: (r) => r.paid, type: "money" },
        { header: "Refunded", value: (r) => r.refunded, type: "money" },
        { header: "Balance", value: (r) => r.balance, type: "money" },
        { header: "Status", value: (r) => r.status },
        { header: "Days overdue", value: (r) => r.daysOverdue || null, type: "number" },
      ],
      rows,
      summary: [
        { label: "Invoices", value: String(live.length) },
        { label: "Invoiced", value: inr(sum(live, (r) => r.total)) },
        { label: "Received", value: inr(sum(live, (r) => r.paid - r.refunded)) },
        { label: "Outstanding", value: inr(sum(live, (r) => r.balance)) },
        { label: "Overdue", value: inr(sum(live.filter((r) => r.statusKey === "overdue"), (r) => r.balance)) },
      ],
      note: "Cancelled invoices are listed but excluded from totals. Invoices of restricted clients are excluded unless you may see them.",
    };
  },
});

/* ---------------------------------------------------------- receivables aging */

interface AgingRow {
  client: string;
  invoices: number;
  current: number;
  d1: number;
  d31: number;
  d61: number;
  d90: number;
  total: number;
}

const receivablesAging = defineReport<AgingRow>({
  key: "receivables-aging",
  title: "Outstanding receivables & aging",
  group: "CRM & Finance",
  description: "What each client owes today, bucketed by how long it is past the due date.",
  permissions: [...FIN, "invoices.view"],
  filters: [{ key: "client", label: "Client", type: "client" }],
  async run(f, user) {
    const today = todayKey();
    const hidden = await hiddenClientIds(user);
    const docs = await db()
      .select({ client: Invoice.client, dueDate: Invoice.dueDate, balance: Invoice.balance })
      .from(Invoice)
      .where(and(inList(Invoice.status, ["issued", "partially_paid", "overdue"]), gt(Invoice.balance, 0), clientScope(f, hidden, Invoice.client)))
      .limit(50_000);
    const clients = await clientNames(docs.map((d) => d.client), user);
    const map = new Map<string, AgingRow>();
    for (const d of docs) {
      const key = d.client;
      const row = map.get(key) ?? { client: clients.get(key) ?? "", invoices: 0, current: 0, d1: 0, d31: 0, d61: 0, d90: 0, total: 0 };
      const late = diffDays(d.dueDate, today);
      row.invoices += 1;
      if (late <= 0) row.current += d.balance;
      else if (late <= 30) row.d1 += d.balance;
      else if (late <= 60) row.d31 += d.balance;
      else if (late <= 90) row.d61 += d.balance;
      else row.d90 += d.balance;
      row.total += d.balance;
      map.set(key, row);
    }
    const rows = [...map.values()].sort((a, b) => b.total - a.total);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const overdue = rows.reduce((s, r) => s + r.d1 + r.d31 + r.d61 + r.d90, 0);
    return {
      columns: [
        { header: "Client", value: (r) => r.client, width: 32 },
        { header: "Open invoices", value: (r) => r.invoices, type: "number" },
        { header: "Not yet due", value: (r) => r.current, type: "money" },
        { header: "1–30 days", value: (r) => r.d1, type: "money" },
        { header: "31–60 days", value: (r) => r.d31, type: "money" },
        { header: "61–90 days", value: (r) => r.d61, type: "money" },
        { header: "Over 90 days", value: (r) => r.d90, type: "money" },
        { header: "Total outstanding", value: (r) => r.total, type: "money" },
      ],
      rows,
      summary: [
        { label: "Outstanding", value: inr(total) },
        { label: "Overdue", value: inr(overdue) },
        { label: "Overdue share", value: total ? `${Math.round((overdue / total) * 100)}%` : "—" },
        { label: "Clients owing", value: String(rows.length) },
      ],
      note: `Aging as of ${fmtDate(today)}, measured from each invoice's due date.`,
    };
  },
});

/* -------------------------------------------------------- client payment history */

interface PaymentRow {
  date: string;
  paymentNo: string;
  client: string;
  invoice: string;
  type: string;
  typeKey: string;
  method: string;
  reference: string;
  amount: number;
  recordedBy: string;
  note: string;
}

const clientPayments = defineReport<PaymentRow>({
  key: "client-payment-history",
  title: "Client payment history",
  group: "CRM & Finance",
  description: "Payments, refunds and adjustments recorded against client invoices.",
  permissions: [...FIN, "invoices.view"],
  filters: [
    ...RANGE_FILTERS,
    { key: "client", label: "Client", type: "client" },
    { key: "type", label: "Type", type: "select", options: ["payment", "refund", "adjustment"].map((s) => ({ value: s, label: statusLabel("payment", s) })) },
  ],
  async run(f, user) {
    const hidden = await hiddenClientIds(user);
    const { from, to } = rangeOf(f);
    const docs = await db()
      .select({
        date: Payment.date,
        paymentNo: Payment.paymentNo,
        client: Payment.client,
        invoice: Payment.invoice,
        type: Payment.type,
        method: Payment.method,
        reference: Payment.reference,
        amount: Payment.amount,
        recordedByName: Payment.recordedByName,
        note: Payment.note,
      })
      .from(Payment)
      .where(and(gte(Payment.date, from), lte(Payment.date, to), clientScope(f, hidden, Payment.client), f.type ? eq(Payment.type, f.type as PaymentType) : undefined))
      .orderBy(desc(Payment.date), desc(Payment.createdAt))
      .limit(20_000);
    const [clients, invoices] = await Promise.all([
      clientNames(docs.map((d) => d.client), user),
      db()
        .select({ id: Invoice._id, invoiceNo: Invoice.invoiceNo, draftNo: Invoice.draftNo })
        .from(Invoice)
        .where(inList(Invoice._id, [...new Set(docs.map((d) => d.invoice))])),
    ]);
    const invoiceNo = new Map(invoices.map((i) => [i.id, invoiceNumber(i)]));
    const rows: PaymentRow[] = docs.map((d) => ({
      date: d.date,
      paymentNo: d.paymentNo,
      client: clients.get(d.client) ?? "",
      invoice: invoiceNo.get(d.invoice) ?? "",
      type: statusLabel("payment", d.type),
      typeKey: d.type,
      method: titleCase(d.method),
      reference: d.reference ?? "",
      amount: d.type === "refund" ? -Math.abs(d.amount) : d.amount,
      recordedBy: d.recordedByName ?? "",
      note: d.note ?? "",
    }));
    const sum = (type: string) => rows.filter((r) => r.typeKey === type).reduce((s, r) => s + r.amount, 0);
    return {
      columns: [
        { header: "Date", value: (r) => fmtDate(r.date) },
        { header: "Payment", value: (r) => r.paymentNo },
        { header: "Client", value: (r) => r.client, width: 28 },
        { header: "Invoice", value: (r) => r.invoice },
        { header: "Type", value: (r) => r.type },
        { header: "Method", value: (r) => r.method },
        { header: "Reference", value: (r) => r.reference, width: 24 },
        { header: "Amount", value: (r) => r.amount, type: "money" },
        { header: "Recorded by", value: (r) => r.recordedBy, width: 22 },
        { header: "Note", value: (r) => r.note, width: 28 },
      ],
      rows,
      summary: [
        { label: "Received", value: inr(sum("payment")) },
        { label: "Refunded", value: inr(Math.abs(sum("refund"))) },
        { label: "Adjustments", value: inr(sum("adjustment")) },
        { label: "Net cash", value: inr(sum("payment") + sum("refund")) },
      ],
      note: "Refunds are shown as negative amounts.",
    };
  },
});

/* -------------------------------------------------------------- monthly revenue */

interface RevenueRow {
  month: string;
  invoices: number;
  invoiced: number;
  tax: number;
  received: number;
  refunded: number;
  net: number;
  outstanding: number;
}

const revenueMonthly = defineReport<RevenueRow>({
  key: "revenue-monthly",
  title: "Monthly revenue summary",
  group: "CRM & Finance",
  description: "Invoiced versus received per month, with refunds and what is still outstanding on that month's invoices.",
  permissions: [...FIN, "invoices.view"],
  filters: [
    { key: "from", label: "From month", type: "month", defaultValue: DEFAULTS.sixMonthsAgo },
    { key: "to", label: "To month", type: "month", defaultValue: DEFAULTS.thisMonth },
  ],
  async run(f) {
    const { from, to } = monthRangeOf(f);
    const lo = `${from}-01`;
    const hi = `${to}-31`;
    const invoiceMonth = sql<string>`substr(${Invoice.issueDate}, 1, 7)`;
    const paymentMonth = sql<string>`substr(${Payment.date}, 1, 7)`;
    const [invoiced, payments] = await Promise.all([
      db()
        .select({ month: invoiceMonth, count: count(), total: sumOf(Invoice.total), tax: sumOf(Invoice.taxTotal), balance: sumOf(Invoice.balance) })
        .from(Invoice)
        .where(and(gte(Invoice.issueDate, lo), lte(Invoice.issueDate, hi), notInList(Invoice.status, ["draft", "cancelled"])))
        .groupBy(invoiceMonth),
      db()
        .select({ month: paymentMonth, type: Payment.type, amount: sumOf(Payment.amount) })
        .from(Payment)
        .where(and(gte(Payment.date, lo), lte(Payment.date, hi)))
        .groupBy(paymentMonth, Payment.type),
    ]);
    const inv = new Map(invoiced.map((i) => [i.month, i]));
    const paid = (month: string, type: string) => payments.find((p) => p.month === month && p.type === type)?.amount ?? 0;
    const rows: RevenueRow[] = [];
    for (let m = from; m <= to; m = addMonths(m, 1)) {
      const i = inv.get(m);
      const received = paid(m, "payment");
      const refunded = Math.abs(paid(m, "refund"));
      rows.push({ month: m, invoices: i?.count ?? 0, invoiced: i?.total ?? 0, tax: i?.tax ?? 0, received, refunded, net: received - refunded, outstanding: i?.balance ?? 0 });
    }
    const sum = (pick: (r: RevenueRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
    const invoicedTotal = sum((r) => r.invoiced);
    return {
      columns: [
        { header: "Month", value: (r) => r.month },
        { header: "Invoices raised", value: (r) => r.invoices, type: "number" },
        { header: "Invoiced", value: (r) => r.invoiced, type: "money" },
        { header: "of which tax", value: (r) => r.tax, type: "money" },
        { header: "Payments received", value: (r) => r.received, type: "money" },
        { header: "Refunds", value: (r) => r.refunded, type: "money" },
        { header: "Net received", value: (r) => r.net, type: "money" },
        { header: "Still outstanding (that month's invoices)", value: (r) => r.outstanding, type: "money" },
        { header: "Received ÷ invoiced %", value: (r) => (r.invoiced ? Math.round((r.net / r.invoiced) * 100) : null), type: "number" },
      ],
      rows,
      summary: [
        { label: "Invoiced", value: inr(invoicedTotal) },
        { label: "Net received", value: inr(sum((r) => r.net)) },
        { label: "Outstanding on these invoices", value: inr(sum((r) => r.outstanding)) },
        { label: "Invoices", value: String(sum((r) => r.invoices)) },
      ],
      note: "Invoiced is by issue date; received is by payment date, so a month's received can exceed its invoiced.",
    };
  },
});

/* -------------------------------------------------------------------- expenses */

const EXPENSE_STATUS_FILTER: ReportFilterDef = {
  key: "status",
  label: "Status",
  type: "select",
  options: ["submitted", "approved", "paid", "rejected"].map((s) => ({ value: s, label: statusLabel("expense", s) })),
};

interface ExpenseGroupRow {
  group: string;
  count: number;
  amount: number;
  tax: number;
  reimbursable: number;
  company: number;
}

const expensesBreakdown = defineReport<ExpenseGroupRow>({
  key: "expenses-breakdown",
  title: "Expenses by category, department & project",
  group: "CRM & Finance",
  description: "Recorded expenses grouped by category, department, project or person.",
  permissions: [...FIN, "expenses.view_all"],
  filters: [
    ...RANGE_FILTERS,
    {
      key: "groupBy",
      label: "Group by",
      type: "select",
      options: [
        { value: "category", label: "Category" },
        { value: "department", label: "Department" },
        { value: "project", label: "Project" },
        { value: "person", label: "Person" },
      ],
      defaultValue: () => "category",
    },
    EXPENSE_STATUS_FILTER,
    { key: "category", label: "Category", type: "select", optionsFrom: "expenseCategories" },
    DEPARTMENT_FILTER,
    { key: "project", label: "Project", type: "project" },
  ],
  async run(f) {
    const { from, to } = rangeOf(f);
    const groupBy = f.groupBy || "category";
    // Summed in SQL per grouping id; groups are then merged by display name (as the old per-document reduce did).
    const groupColumn = groupBy === "department" ? Expense.department : groupBy === "project" ? Expense.project : groupBy === "person" ? Expense.user : Expense.category;
    const groups = await db()
      .select({
        key: groupColumn,
        count: count(),
        amount: sumOf(Expense.amount),
        tax: sumOf(Expense.taxAmount),
        reimbursable: sumOf(sql`case when ${Expense.type} = 'reimbursable' then ${Expense.amount} else 0 end`),
        company: sumOf(sql`case when ${Expense.type} = 'reimbursable' then 0 else ${Expense.amount} end`),
      })
      .from(Expense)
      .where(
        and(
          gte(Expense.date, from),
          lte(Expense.date, to),
          f.status ? eq(Expense.status, f.status as ExpenseStatus) : inList(Expense.status, ["approved", "paid"]),
          f.category ? eq(Expense.category, f.category) : undefined,
          f.department ? eq(Expense.department, f.department) : undefined,
          f.project ? eq(Expense.project, f.project) : undefined,
        ),
      )
      .groupBy(groupColumn);
    const [departments, projects, people] = await Promise.all([
      groupBy === "department" ? db().select({ id: Department._id, name: Department.name }).from(Department) : Promise.resolve([]),
      groupBy === "project" ? projectMap(groups.map((g) => g.key)) : Promise.resolve(new Map<string, ProjectInfo>()),
      groupBy === "person" ? peopleMap(groups.map((g) => g.key)) : Promise.resolve(new Map<string, PersonInfo>()),
    ]);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const keyOf = (id: string | null): string => {
      if (groupBy === "department") return id ? (deptName.get(id) ?? "Unknown") : "No department";
      if (groupBy === "project") {
        const p = id ? projects.get(id) : undefined;
        return p ? `${p.projectNo} · ${p.title}` : "No project";
      }
      if (groupBy === "person") return (id ? people.get(id)?.name : undefined) ?? "Unknown";
      return id ?? "";
    };
    const map = new Map<string, ExpenseGroupRow>();
    for (const g of groups) {
      const key = keyOf(g.key);
      const row = map.get(key) ?? { group: key, count: 0, amount: 0, tax: 0, reimbursable: 0, company: 0 };
      row.count += g.count;
      row.amount += g.amount;
      row.tax += g.tax;
      row.reimbursable += g.reimbursable;
      row.company += g.company;
      map.set(key, row);
    }
    const rows = [...map.values()].sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const header = { category: "Category", department: "Department", project: "Project", person: "Person" }[groupBy] ?? "Category";
    return {
      columns: [
        { header, value: (r) => r.group, width: 34 },
        { header: "Expenses", value: (r) => r.count, type: "number" },
        { header: "Amount", value: (r) => r.amount, type: "money" },
        { header: "of which tax", value: (r) => r.tax, type: "money" },
        { header: "Reimbursable", value: (r) => r.reimbursable, type: "money" },
        { header: "Paid by company", value: (r) => r.company, type: "money" },
        { header: "Share %", value: (r) => (total ? Math.round((r.amount / total) * 100) : null), type: "number" },
      ],
      rows,
      summary: [
        { label: "Expenses", value: String(rows.reduce((s, r) => s + r.count, 0)) },
        { label: "Total", value: inr(total) },
        { label: "Reimbursable", value: inr(rows.reduce((s, r) => s + r.reimbursable, 0)) },
        { label: "Groups", value: String(rows.length) },
      ],
      note: f.status ? undefined : "Counts approved and paid expenses; drafts, pending and rejected claims are excluded.",
    };
  },
});

interface ReimbursementRow {
  person: PersonInfo;
  expenseNo: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  status: string;
  statusKey: string;
  approver: string;
  decidedAt?: Date;
  paidOn: string;
  viaPayroll: string;
}

const reimbursements = defineReport<ReimbursementRow>({
  key: "reimbursements",
  title: "Reimbursements",
  group: "CRM & Finance",
  description: "Employee-paid expenses claimed for reimbursement, with approval and payment status.",
  permissions: [...FIN, "expenses.view_all"],
  filters: [
    ...RANGE_FILTERS,
    { ...EXPENSE_STATUS_FILTER, options: ["draft", "submitted", "approved", "paid", "rejected"].map((s) => ({ value: s, label: statusLabel("expense", s) })) },
    DEPARTMENT_FILTER,
    PERSON_FILTER,
  ],
  async run(f) {
    const { from, to } = rangeOf(f);
    const docs = await db()
      .select({
        user: Expense.user,
        expenseNo: Expense.expenseNo,
        date: Expense.date,
        category: Expense.category,
        description: Expense.description,
        amount: Expense.amount,
        status: Expense.status,
        approverName: Expense.approverName,
        decidedAt: Expense.decidedAt,
        payment: Expense.payment,
      })
      .from(Expense)
      .where(
        and(
          eq(Expense.type, "reimbursable"),
          gte(Expense.date, from),
          lte(Expense.date, to),
          f.status ? eq(Expense.status, f.status as ExpenseStatus) : ne(Expense.status, "draft"),
          userScope(f, Expense.user),
        ),
      )
      .orderBy(desc(Expense.date))
      .limit(20_000);
    const people = await peopleMap(docs.map((d) => d.user));
    const rows: ReimbursementRow[] = docs.flatMap((d) => {
      const person = people.get(d.user);
      if (!person) return [];
      return [
        {
          person,
          expenseNo: d.expenseNo,
          date: d.date,
          category: d.category,
          description: d.description,
          amount: d.amount,
          status: statusLabel("expense", d.status),
          statusKey: d.status,
          approver: d.approverName ?? "",
          decidedAt: d.decidedAt ?? undefined,
          paidOn: fmtDate(d.payment?.date),
          viaPayroll: d.payment?.viaPayroll ? "Yes" : d.status === "paid" ? "No" : "",
        },
      ];
    });
    const sum = (key: string) => rows.filter((r) => r.statusKey === key).reduce((s, r) => s + r.amount, 0);
    return {
      columns: [
        { header: "Expense", value: (r) => r.expenseNo },
        { header: "Date", value: (r) => fmtDate(r.date) },
        { header: "Employee ID", value: (r) => r.person.employeeId },
        { header: "Employee", value: (r) => r.person.name, width: 24 },
        { header: "Department", value: (r) => r.person.department, width: 20 },
        { header: "Category", value: (r) => r.category },
        { header: "Description", value: (r) => r.description, width: 36 },
        { header: "Amount", value: (r) => r.amount, type: "money" },
        { header: "Status", value: (r) => r.status },
        { header: "Approved / decided by", value: (r) => r.approver, width: 22 },
        { header: "Decided on", value: (r) => fmtDate(r.decidedAt) },
        { header: "Paid on", value: (r) => r.paidOn },
        { header: "Via payroll", value: (r) => r.viaPayroll },
      ],
      rows,
      summary: [
        { label: "Claims", value: String(rows.length) },
        { label: "Awaiting approval", value: inr(sum("submitted")) },
        { label: "Approved, unpaid", value: inr(sum("approved")) },
        { label: "Paid", value: inr(sum("paid")) },
      ],
    };
  },
});

/* ----------------------------------------------------------- project profitability */

interface ProfitRow {
  projectNo: string;
  title: string;
  client: string;
  status: string;
  budget: number;
  invoiced: number;
  received: number;
  outstanding: number;
  expenses: number;
  margin: number;
}

const projectProfitability = defineReport<ProfitRow>({
  key: "project-profitability",
  title: "Project-wise income & expenses",
  group: "CRM & Finance",
  description: "Invoiced, received and spent per project with an estimated margin and budget use.",
  permissions: [...FIN, "projects.financials"],
  filters: [
    { key: "status", label: "Status", type: "select", optionsFrom: "projectStatuses" },
    { key: "client", label: "Client", type: "client" },
    { key: "project", label: "Project", type: "project" },
  ],
  async run(f, user) {
    const settings = await getSettings();
    const hidden = await hiddenClientIds(user);
    const projects = await db()
      .select({ id: Project._id, projectNo: Project.projectNo, title: Project.title, client: Project.client, status: Project.status, budget: Project.budget })
      .from(Project)
      .where(and(clientScope(f, hidden, Project.client), f.status ? eq(Project.status, f.status) : undefined, f.project ? eq(Project._id, f.project) : undefined))
      .orderBy(desc(Project.createdAt))
      .limit(2000);
    const ids = projects.map((p) => p.id);
    const [invoiced, received, spent, clients] = await Promise.all([
      db()
        .select({ project: Invoice.project, total: sumOf(Invoice.total), balance: sumOf(Invoice.balance) })
        .from(Invoice)
        .where(and(inList(Invoice.project, ids), notInList(Invoice.status, ["draft", "cancelled"])))
        .groupBy(Invoice.project),
      db()
        .select({ project: Payment.project, type: Payment.type, amount: sumOf(Payment.amount) })
        .from(Payment)
        .where(and(inList(Payment.project, ids), inList(Payment.type, ["payment", "refund"])))
        .groupBy(Payment.project, Payment.type),
      db()
        .select({ project: Expense.project, amount: sumOf(Expense.amount) })
        .from(Expense)
        .where(and(inList(Expense.project, ids), inList(Expense.status, ["approved", "paid"])))
        .groupBy(Expense.project),
      clientNames(projects.map((p) => p.client), user),
    ]);
    const inv = new Map(invoiced.map((i) => [i.project, i]));
    const exp = new Map(spent.map((e) => [e.project, e.amount]));
    const cash = (id: string) => received.filter((r) => r.project === id).reduce((s, r) => s + (r.type === "refund" ? -Math.abs(r.amount) : r.amount), 0);
    const rows: ProfitRow[] = projects.map((p) => {
      const id = p.id;
      const i = inv.get(id);
      const expenses = exp.get(id) ?? 0;
      return {
        projectNo: p.projectNo,
        title: p.title,
        client: p.client ? (clients.get(p.client) ?? "") : "Internal",
        status: optionLabel(settings.projectStatuses, p.status),
        budget: p.budget,
        invoiced: i?.total ?? 0,
        received: cash(id),
        outstanding: i?.balance ?? 0,
        expenses,
        margin: (i?.total ?? 0) - expenses,
      };
    });
    const sum = (pick: (r: ProfitRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
    return {
      columns: [
        { header: "Project", value: (r) => r.projectNo },
        { header: "Title", value: (r) => r.title, width: 32 },
        { header: "Client", value: (r) => r.client, width: 24 },
        { header: "Status", value: (r) => r.status },
        { header: "Budget", value: (r) => r.budget, type: "money" },
        { header: "Invoiced", value: (r) => r.invoiced, type: "money" },
        { header: "Received", value: (r) => r.received, type: "money" },
        { header: "Outstanding", value: (r) => r.outstanding, type: "money" },
        { header: "Expenses", value: (r) => r.expenses, type: "money" },
        { header: "Estimated margin", value: (r) => r.margin, type: "money" },
        { header: "Margin %", value: (r) => (r.invoiced > 0 ? Math.round((r.margin / r.invoiced) * 100) : null), type: "number" },
        { header: "Expenses vs budget %", value: (r) => (r.budget > 0 ? Math.round((r.expenses / r.budget) * 100) : null), type: "number" },
      ],
      rows,
      summary: [
        { label: "Invoiced", value: inr(sum((r) => r.invoiced)) },
        { label: "Received", value: inr(sum((r) => r.received)) },
        { label: "Expenses", value: inr(sum((r) => r.expenses)) },
        { label: "Estimated margin", value: inr(sum((r) => r.margin)) },
      ],
      note: "Margin = invoiced − recorded project expenses. It excludes staff cost, so treat it as an estimate.",
    };
  },
});

/* --------------------------------------------------------------- asset register */

interface AssetRow {
  assetNo: string;
  kind: string;
  name: string;
  category: string;
  brandModel: string;
  serialNo: string;
  purchaseDate?: string;
  cost: number;
  status: string;
  statusKey: string;
  condition: string;
  assignedTo: string;
  department: string;
  location: string;
  warrantyUntil?: string;
  nextService?: string;
}

const assetRegister = defineReport<AssetRow>({
  key: "asset-register",
  title: "Asset register",
  group: "CRM & Finance",
  description: "Staff and company assets with cost, status, condition, current holder, warranty and service dates.",
  permissions: ["reports.view", "assets.view"],
  filters: [
    { key: "kind", label: "Type", type: "select", options: ASSET_KINDS.map((k) => ({ value: k, label: ASSET_KIND_LABELS[k].plural })) },
    { key: "status", label: "Status", type: "select", options: ASSET_STATUSES.map((s) => ({ value: s, label: statusLabel("asset", s) })) },
    { key: "category", label: "Category", type: "select", optionsFrom: "assetCategories" },
    { ...PERSON_FILTER, label: "Assigned to" },
    DEPARTMENT_FILTER,
  ],
  async run(f) {
    const today = todayKey();
    const [assets, departments] = await Promise.all([
      db()
        .select({
          assetNo: Asset.assetNo,
          kind: Asset.kind,
          name: Asset.name,
          category: Asset.category,
          brand: Asset.brand,
          model: Asset.model,
          serialNo: Asset.serialNo,
          purchaseDate: Asset.purchaseDate,
          cost: Asset.cost,
          status: Asset.status,
          condition: Asset.condition,
          assignedTo: Asset.assignedTo,
          department: Asset.department,
          location: Asset.location,
          warrantyUntil: Asset.warrantyUntil,
          nextServiceDate: Asset.nextServiceDate,
        })
        .from(Asset)
        .where(
          and(
            f.kind === "staff" || f.kind === "company" ? eq(Asset.kind, f.kind) : undefined,
            f.status ? eq(Asset.status, f.status as AssetStatus) : undefined,
            f.category ? eq(Asset.category, f.category) : undefined,
            f.person ? eq(Asset.assignedTo, f.person) : undefined,
            f.department ? eq(Asset.department, f.department) : undefined,
          ),
        )
        .orderBy(asc(Asset.assetNo))
        .limit(20_000),
      db().select({ id: Department._id, name: Department.name }).from(Department),
    ]);
    const people = await peopleMap(assets.map((a) => a.assignedTo));
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const rows: AssetRow[] = assets.map((a) => ({
      assetNo: a.assetNo,
      kind: ASSET_KIND_LABELS[a.kind]?.label ?? a.kind,
      name: a.name,
      category: a.category,
      brandModel: [a.brand, a.model].filter(Boolean).join(" "),
      serialNo: a.serialNo ?? "",
      purchaseDate: a.purchaseDate ?? undefined,
      cost: a.cost,
      status: statusLabel("asset", a.status),
      statusKey: a.status,
      condition: statusLabel("assetCondition", a.condition),
      assignedTo: a.assignedTo ? (people.get(a.assignedTo)?.name ?? "") : "",
      department: a.department ? (deptName.get(a.department) ?? "") : "",
      location: a.location ?? "",
      warrantyUntil: a.warrantyUntil ?? undefined,
      nextService: a.nextServiceDate ?? undefined,
    }));
    const soon = addDays(today, 60);
    return {
      columns: [
        { header: "Asset", value: (r) => r.assetNo },
        { header: "Type", value: (r) => r.kind },
        { header: "Name", value: (r) => r.name, width: 28 },
        { header: "Category", value: (r) => r.category },
        { header: "Brand / model", value: (r) => r.brandModel, width: 22 },
        { header: "Serial no.", value: (r) => r.serialNo, width: 20 },
        { header: "Purchased", value: (r) => fmtDate(r.purchaseDate) },
        { header: "Cost", value: (r) => r.cost, type: "money" },
        { header: "Status", value: (r) => r.status },
        { header: "Condition", value: (r) => r.condition },
        { header: "Assigned to", value: (r) => r.assignedTo, width: 22 },
        { header: "Department", value: (r) => r.department, width: 20 },
        { header: "Location", value: (r) => r.location },
        { header: "Warranty until", value: (r) => fmtDate(r.warrantyUntil) },
        { header: "Next service", value: (r) => fmtDate(r.nextService) },
      ],
      rows,
      summary: [
        { label: "Assets", value: String(rows.length) },
        { label: "Total cost", value: inr(round2(rows.reduce((s, r) => s + r.cost, 0))) },
        { label: "Assigned", value: String(rows.filter((r) => r.statusKey === "assigned").length) },
        { label: "Company assets", value: `${rows.filter((r) => r.kind === ASSET_KIND_LABELS.company.label).length} · ${inr(round2(rows.filter((r) => r.kind === ASSET_KIND_LABELS.company.label).reduce((s, r) => s + r.cost, 0)))}` },
        { label: "Needs attention", value: String(rows.filter((r) => ["in_repair", "damaged", "lost"].includes(r.statusKey)).length) },
        { label: "Warranty ending in 60 days", value: String(rows.filter((r) => r.warrantyUntil && r.warrantyUntil >= today && r.warrantyUntil <= soon).length) },
      ],
    };
  },
});

export const financeReports = [
  invoiceStatus,
  receivablesAging,
  clientPayments,
  revenueMonthly,
  expensesBreakdown,
  reimbursements,
  projectProfitability,
  assetRegister,
];
