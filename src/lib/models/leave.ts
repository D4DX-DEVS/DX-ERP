import { defineModel, FileRefSchema, ObjectIdType, Schema, type FileRef, type ObjectId } from "./_base";

export interface ILeaveType {
  _id: ObjectId;
  name: string;
  code: string;
  color?: string;
  annualQuota: number;
  accrual: "upfront" | "monthly";
  carryForward: boolean;
  maxCarryForward: number;
  paid: boolean;
  allowHalfDay: boolean;
  requiresHrApproval: boolean;
  requiresAttachmentAfterDays?: number;
  applicableTo: string[];
  active: boolean;
  order: number;
}

const LeaveTypeSchema = new Schema<ILeaveType>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    color: String,
    annualQuota: { type: Number, default: 0, min: 0 },
    accrual: { type: String, enum: ["upfront", "monthly"], default: "upfront" },
    carryForward: { type: Boolean, default: false },
    maxCarryForward: { type: Number, default: 0 },
    paid: { type: Boolean, default: true },
    allowHalfDay: { type: Boolean, default: true },
    requiresHrApproval: { type: Boolean, default: false },
    requiresAttachmentAfterDays: Number,
    applicableTo: { type: [String], default: ["employee", "trainee", "intern"] },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const LeaveType = defineModel<ILeaveType>("LeaveType", LeaveTypeSchema);

/**
 * Per user / type / leave-year adjustments. "Used" and "accrued" are always computed from
 * approved requests and the type's quota, so balances never drift.
 */
export interface ILeaveBalance {
  _id: ObjectId;
  user: ObjectId;
  leaveType: ObjectId;
  year: number;
  carriedForward: number;
  adjustment: number;
  /** Optional per-person override of the annual quota (e.g. pro-rated for mid-year joiners). */
  quotaOverride?: number;
  notes: { _id?: ObjectId; amount: number; reason: string; by?: ObjectId; byName?: string; at: Date }[];
}

const LeaveBalanceSchema = new Schema<ILeaveBalance>(
  {
    user: { type: ObjectIdType, ref: "User", required: true },
    leaveType: { type: ObjectIdType, ref: "LeaveType", required: true },
    year: { type: Number, required: true },
    carriedForward: { type: Number, default: 0 },
    adjustment: { type: Number, default: 0 },
    quotaOverride: Number,
    notes: {
      type: [
        new Schema({
          amount: Number,
          reason: String,
          by: { type: ObjectIdType, ref: "User" },
          byName: String,
          at: { type: Date, default: Date.now },
        }),
      ],
      default: [],
    },
  },
  { timestamps: true },
);
LeaveBalanceSchema.index({ user: 1, leaveType: 1, year: 1 }, { unique: true });

export const LeaveBalance = defineModel<ILeaveBalance>("LeaveBalance", LeaveBalanceSchema);

export type LeaveStatus = "pending_manager" | "pending_hr" | "approved" | "rejected" | "cancelled";

export interface LeaveApproval {
  _id?: ObjectId;
  level: "manager" | "hr";
  by: ObjectId;
  byName: string;
  action: "approved" | "rejected";
  note?: string;
  at: Date;
}

export interface ILeaveRequest {
  _id: ObjectId;
  requestNo: string;
  user: ObjectId;
  leaveType: ObjectId;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  halfDaySession?: "first" | "second";
  days: number;
  reason: string;
  status: LeaveStatus;
  manager?: ObjectId;
  approvals: LeaveApproval[];
  attachments: FileRef[];
  cancelledAt?: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LeaveRequestSchema = new Schema<ILeaveRequest>(
  {
    requestNo: { type: String, required: true, unique: true },
    user: { type: ObjectIdType, ref: "User", required: true, index: true },
    leaveType: { type: ObjectIdType, ref: "LeaveType", required: true },
    leaveTypeName: String,
    startDate: { type: String, required: true, index: true },
    endDate: { type: String, required: true, index: true },
    halfDay: { type: Boolean, default: false },
    halfDaySession: { type: String, enum: ["first", "second"] },
    days: { type: Number, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["pending_manager", "pending_hr", "approved", "rejected", "cancelled"],
      default: "pending_manager",
      index: true,
    },
    manager: { type: ObjectIdType, ref: "User", index: true },
    approvals: {
      type: [
        new Schema<LeaveApproval>({
          level: { type: String, enum: ["manager", "hr"], required: true },
          by: { type: ObjectIdType, ref: "User", required: true },
          byName: String,
          action: { type: String, enum: ["approved", "rejected"], required: true },
          note: String,
          at: { type: Date, default: Date.now },
        }),
      ],
      default: [],
    },
    attachments: { type: [FileRefSchema], default: [] },
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true },
);

export const LeaveRequest = defineModel<ILeaveRequest>("LeaveRequest", LeaveRequestSchema);
