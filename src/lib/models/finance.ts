import {
  defineModel,
  FileRefSchema,
  HistorySchema,
  LineItemSchema,
  ObjectIdType,
  Schema,
  type FileRef,
  type HistoryEntry,
  type LineItem,
  type ObjectId,
} from "./_base";

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

export interface IInvoice {
  _id: ObjectId;
  invoiceNo?: string;
  draftNo: string;
  client: ObjectId;
  project?: ObjectId;
  contract?: ObjectId;
  milestone?: ObjectId;
  issueDate: string;
  dueDate: string;
  paymentTermDays: number;
  items: LineItem[];
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  amountRefunded: number;
  adjustments: number;
  balance: number;
  status: InvoiceStatus;
  notes?: string;
  terms?: string;
  placeOfSupply?: string;
  billingSnapshot?: { name: string; address?: string; gstin?: string; email?: string };
  issuedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  overdueNotifiedAt?: Date;
  dueReminderSentAt?: Date;
  history: HistoryEntry[];
  createdBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema = new Schema<IInvoice>(
  {
    invoiceNo: { type: String, unique: true, sparse: true },
    draftNo: { type: String, required: true, unique: true },
    client: { type: ObjectIdType, ref: "Client", required: true, index: true },
    project: { type: ObjectIdType, ref: "Project", index: true },
    contract: { type: ObjectIdType, ref: "Contract" },
    milestone: { type: ObjectIdType },
    issueDate: { type: String, required: true },
    dueDate: { type: String, required: true, index: true },
    paymentTermDays: { type: Number, default: 15 },
    items: { type: [LineItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0 },
    amountRefunded: { type: Number, default: 0 },
    adjustments: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"],
      default: "draft",
      index: true,
    },
    notes: String,
    terms: String,
    placeOfSupply: String,
    billingSnapshot: { name: String, address: String, gstin: String, email: String },
    issuedAt: Date,
    cancelledAt: Date,
    cancelReason: String,
    overdueNotifiedAt: Date,
    dueReminderSentAt: Date,
    history: { type: [HistorySchema], default: [] },
    createdBy: { type: ObjectIdType, ref: "User" },
  },
  { timestamps: true },
);

export const Invoice = defineModel<IInvoice>("Invoice", InvoiceSchema);

export type PaymentType = "payment" | "refund" | "adjustment";

export interface IPayment {
  _id: ObjectId;
  paymentNo: string;
  invoice: ObjectId;
  client: ObjectId;
  project?: ObjectId;
  type: PaymentType;
  date: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  recordedBy: ObjectId;
  recordedByName: string;
  createdAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    paymentNo: { type: String, required: true, unique: true },
    invoice: { type: ObjectIdType, ref: "Invoice", required: true, index: true },
    client: { type: ObjectIdType, ref: "Client", required: true, index: true },
    project: { type: ObjectIdType, ref: "Project" },
    type: { type: String, enum: ["payment", "refund", "adjustment"], default: "payment" },
    date: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true },
    reference: String,
    note: String,
    recordedBy: { type: ObjectIdType, ref: "User", required: true },
    recordedByName: String,
  },
  { timestamps: true },
);

export const Payment = defineModel<IPayment>("Payment", PaymentSchema);

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";

export interface IExpense {
  _id: ObjectId;
  expenseNo: string;
  /** Person who incurred / submitted the expense. */
  user: ObjectId;
  date: string;
  category: string;
  department?: ObjectId;
  project?: ObjectId;
  client?: ObjectId;
  vendor?: string;
  amount: number;
  taxAmount: number;
  description: string;
  /** reimbursable = paid by the employee and owed back; company = paid directly by the company. */
  type: "reimbursable" | "company";
  paymentMode?: string;
  receipts: FileRef[];
  status: ExpenseStatus;
  submittedAt?: Date;
  approver?: ObjectId;
  approverName?: string;
  decidedAt?: Date;
  decisionNote?: string;
  payment?: { date?: string; method?: string; reference?: string; viaPayroll?: boolean; by?: ObjectId; byName?: string };
  history: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    expenseNo: { type: String, required: true, unique: true },
    user: { type: ObjectIdType, ref: "User", required: true, index: true },
    date: { type: String, required: true, index: true },
    category: { type: String, required: true },
    department: { type: ObjectIdType, ref: "Department" },
    project: { type: ObjectIdType, ref: "Project", index: true },
    client: { type: ObjectIdType, ref: "Client" },
    vendor: String,
    amount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0 },
    description: { type: String, required: true, maxlength: 2000 },
    type: { type: String, enum: ["reimbursable", "company"], default: "reimbursable" },
    paymentMode: String,
    receipts: { type: [FileRefSchema], default: [] },
    status: { type: String, enum: ["draft", "submitted", "approved", "rejected", "paid"], default: "draft", index: true },
    submittedAt: Date,
    approver: { type: ObjectIdType, ref: "User" },
    approverName: String,
    decidedAt: Date,
    decisionNote: String,
    payment: {
      date: String,
      method: String,
      reference: String,
      viaPayroll: Boolean,
      by: { type: ObjectIdType, ref: "User" },
      byName: String,
    },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);

export const Expense = defineModel<IExpense>("Expense", ExpenseSchema);
