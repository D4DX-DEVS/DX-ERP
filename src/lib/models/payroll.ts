import { defineModel, HistorySchema, ObjectIdType, Schema, type HistoryEntry, type ObjectId } from "./_base";

export type PayrollKind = "salary" | "stipend";
/** draft → verified (HR checked attendance/leave) → approved (management) → paid (finance). */
export type PayrollRunStatus = "draft" | "verified" | "approved" | "paid" | "cancelled";

export interface IPayrollRun {
  _id: ObjectId;
  runNo: string;
  period: string;
  kind: PayrollKind;
  status: PayrollRunStatus;
  workingDays: number;
  notes?: string;
  totals: { count: number; gross: number; deductions: number; net: number };
  /** "period:kind" while the run is active (not cancelled); unique, so two active runs for a month and kind cannot exist. */
  activeKey?: string;
  preparedBy?: ObjectId;
  preparedByName?: string;
  verifiedBy?: ObjectId;
  verifiedByName?: string;
  verifiedAt?: Date;
  approvedBy?: ObjectId;
  approvedByName?: string;
  approvedAt?: Date;
  paidAt?: Date;
  /** Everyone who edited payslip lines or recalculated the run — they may not approve or pay it (separation of duties). */
  editors?: ObjectId[];
  history: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const PayrollRunSchema = new Schema<IPayrollRun>(
  {
    runNo: { type: String, required: true, unique: true },
    period: { type: String, required: true },
    kind: { type: String, enum: ["salary", "stipend"], required: true },
    status: { type: String, enum: ["draft", "verified", "approved", "paid", "cancelled"], default: "draft", index: true },
    workingDays: { type: Number, default: 0 },
    notes: String,
    totals: {
      count: { type: Number, default: 0 },
      gross: { type: Number, default: 0 },
      deductions: { type: Number, default: 0 },
      net: { type: Number, default: 0 },
    },
    activeKey: String,
    preparedBy: { type: ObjectIdType, ref: "User" },
    preparedByName: String,
    verifiedBy: { type: ObjectIdType, ref: "User" },
    verifiedByName: String,
    verifiedAt: Date,
    approvedBy: { type: ObjectIdType, ref: "User" },
    approvedByName: String,
    approvedAt: Date,
    paidAt: Date,
    editors: { type: [{ type: ObjectIdType, ref: "User" }], default: [] },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);
// MongoDB partial indexes cannot express "status is not cancelled", so uniqueness of the active run per month and kind
// is enforced through `activeKey`, which is removed when a run is cancelled.
PayrollRunSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
PayrollRunSchema.index({ period: 1, kind: 1 });

export const PayrollRun = defineModel<IPayrollRun>("PayrollRun", PayrollRunSchema);

export interface PayLine {
  key?: string;
  name: string;
  amount: number;
  /** "auto" lines are recalculated; "manual" lines (bonus, incentive, overtime, TDS…) are kept. */
  source: "auto" | "manual";
}

export interface IPayslip {
  _id: ObjectId;
  run: ObjectId;
  user: ObjectId;
  period: string;
  kind: PayrollKind;
  snapshot: {
    name: string;
    employeeId: string;
    designation?: string;
    department?: string;
    joiningDate?: string;
    bankAccount?: string;
    ifsc?: string;
    bankName?: string;
    pan?: string;
  };
  workingDays: number;
  payableDays: number;
  lopDays: number;
  presentDays: number;
  leaveDays: number;
  basic: number;
  earnings: PayLine[];
  deductions: PayLine[];
  gross: number;
  totalDeductions: number;
  net: number;
  status: "draft" | "approved" | "paid" | "on_hold";
  payment?: { date?: string; method?: string; reference?: string; by?: ObjectId; byName?: string; at?: Date };
  remarks?: string;
  advanceRecoveries: { advance: ObjectId; amount: number }[];
  reimbursedExpenses: ObjectId[];
  /** Manual line edits with their amounts (shown only to `payroll.view` holders on the run page). */
  history?: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const PayLineSchema = new Schema<PayLine>(
  {
    key: String,
    name: { type: String, required: true },
    amount: { type: Number, default: 0 },
    source: { type: String, enum: ["auto", "manual"], default: "auto" },
  },
  { _id: false },
);

const PayslipSchema = new Schema<IPayslip>(
  {
    run: { type: ObjectIdType, ref: "PayrollRun", required: true, index: true },
    user: { type: ObjectIdType, ref: "User", required: true, index: true },
    period: { type: String, required: true, index: true },
    kind: { type: String, enum: ["salary", "stipend"], required: true },
    snapshot: {
      name: String,
      employeeId: String,
      designation: String,
      department: String,
      joiningDate: String,
      bankAccount: String,
      ifsc: String,
      bankName: String,
      pan: String,
    },
    workingDays: { type: Number, default: 0 },
    payableDays: { type: Number, default: 0 },
    lopDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    leaveDays: { type: Number, default: 0 },
    basic: { type: Number, default: 0 },
    earnings: { type: [PayLineSchema], default: [] },
    deductions: { type: [PayLineSchema], default: [] },
    gross: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    status: { type: String, enum: ["draft", "approved", "paid", "on_hold"], default: "draft" },
    payment: {
      date: String,
      method: String,
      reference: String,
      by: { type: ObjectIdType, ref: "User" },
      byName: String,
      at: Date,
    },
    remarks: String,
    advanceRecoveries: {
      type: [new Schema({ advance: { type: ObjectIdType, ref: "SalaryAdvance" }, amount: Number }, { _id: false })],
      default: [],
    },
    reimbursedExpenses: { type: [{ type: ObjectIdType, ref: "Expense" }], default: [] },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);
PayslipSchema.index({ run: 1, user: 1 }, { unique: true });

export const Payslip = defineModel<IPayslip>("Payslip", PayslipSchema);

export interface ISalaryAdvance {
  _id: ObjectId;
  user: ObjectId;
  amount: number;
  date: string;
  reason?: string;
  monthlyRecovery: number;
  recovered: number;
  status: "open" | "closed";
  recordedBy?: ObjectId;
  recordedByName?: string;
  recoveries: { period: string; amount: number; payslip?: ObjectId }[];
  createdAt: Date;
}

const SalaryAdvanceSchema = new Schema<ISalaryAdvance>(
  {
    user: { type: ObjectIdType, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: String, required: true },
    reason: String,
    monthlyRecovery: { type: Number, default: 0 },
    recovered: { type: Number, default: 0 },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    recordedBy: { type: ObjectIdType, ref: "User" },
    recordedByName: String,
    recoveries: {
      type: [new Schema({ period: String, amount: Number, payslip: { type: ObjectIdType, ref: "Payslip" } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);

export const SalaryAdvance = defineModel<ISalaryAdvance>("SalaryAdvance", SalaryAdvanceSchema);
