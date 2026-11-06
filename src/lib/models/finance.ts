import { index, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";
import { date, int, json, num, pk, ref, text, timestamps, type FileRef, type HistoryEntry, type Id, type LineItem } from "./_base";

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface BillingSnapshot {
  name: string;
  contactPerson?: string;
  address?: string;
  gstin?: string;
  email?: string;
  phone?: string;
}

export const Invoice = sqliteTable(
  "invoices",
  {
    _id: pk(),
    invoiceNo: text(),
    draftNo: text().notNull(),
    client: ref().notNull(),
    project: ref(),
    contract: ref(),
    milestone: ref(),
    issueDate: text().notNull(),
    dueDate: text().notNull(),
    paymentTermDays: int().notNull().default(15),
    items: json<LineItem[]>()
      .notNull()
      .$defaultFn(() => []),
    subtotal: num().notNull().default(0),
    discount: num().notNull().default(0),
    taxTotal: num().notNull().default(0),
    total: num().notNull().default(0),
    amountPaid: num().notNull().default(0),
    amountRefunded: num().notNull().default(0),
    adjustments: num().notNull().default(0),
    balance: num().notNull().default(0),
    status: text().$type<InvoiceStatus>().notNull().default("draft"),
    notes: text(),
    terms: text(),
    placeOfSupply: text(),
    billingSnapshot: json<BillingSnapshot>(),
    issuedAt: date(),
    cancelledAt: date(),
    cancelReason: text(),
    overdueNotifiedAt: date(),
    dueReminderSentAt: date(),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [
    // Drafts saved before invoice numbers were entered by hand have no invoiceNo (NULL); NULLs are distinct in SQLite unique indexes.
    uniqueIndex("invoices_invoice_no").on(t.invoiceNo),
    uniqueIndex("invoices_draft_no").on(t.draftNo),
    index("invoices_client").on(t.client),
    index("invoices_project").on(t.project),
    index("invoices_due_date").on(t.dueDate),
    index("invoices_status").on(t.status),
  ],
);
export type IInvoice = typeof Invoice.$inferSelect;

export type PaymentType = "payment" | "refund" | "adjustment";

export const Payment = sqliteTable(
  "payments",
  {
    _id: pk(),
    paymentNo: text().notNull(),
    invoice: ref().notNull(),
    client: ref().notNull(),
    project: ref(),
    type: text().$type<PaymentType>().notNull().default("payment"),
    date: text().notNull(),
    amount: num().notNull(),
    method: text().notNull(),
    reference: text(),
    note: text(),
    recordedBy: ref().notNull(),
    recordedByName: text(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payments_payment_no").on(t.paymentNo),
    index("payments_invoice").on(t.invoice),
    index("payments_client").on(t.client),
    index("payments_date").on(t.date),
  ],
);
export type IPayment = typeof Payment.$inferSelect;

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";

export interface ExpensePayment {
  date?: string;
  method?: string;
  reference?: string;
  viaPayroll?: boolean;
  by?: Id;
  byName?: string;
}

export const Expense = sqliteTable(
  "expenses",
  {
    _id: pk(),
    expenseNo: text().notNull(),
    /** Person who incurred / submitted the expense. */
    user: ref().notNull(),
    date: text().notNull(),
    category: text().notNull(),
    department: ref(),
    project: ref(),
    client: ref(),
    vendor: text(),
    amount: num().notNull(),
    taxAmount: num().notNull().default(0),
    description: text().notNull(),
    /** reimbursable = paid by the employee and owed back; company = paid directly by the company. */
    type: text().$type<"reimbursable" | "company">().notNull().default("reimbursable"),
    paymentMode: text(),
    receipts: json<FileRef[]>()
      .notNull()
      .$defaultFn(() => []),
    status: text().$type<ExpenseStatus>().notNull().default("draft"),
    submittedAt: date(),
    approver: ref(),
    approverName: text(),
    decidedAt: date(),
    decisionNote: text(),
    payment: json<ExpensePayment>(),
    history: json<HistoryEntry[]>()
      .notNull()
      .$defaultFn(() => []),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("expenses_expense_no").on(t.expenseNo),
    index("expenses_user").on(t.user),
    index("expenses_date").on(t.date),
    index("expenses_project").on(t.project),
    index("expenses_status").on(t.status),
  ],
);
export type IExpense = typeof Expense.$inferSelect;
