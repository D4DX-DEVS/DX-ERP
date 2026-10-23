import { defineModel, HistorySchema, ObjectIdType, Schema, type HistoryEntry, type ObjectId } from "./_base";

/** Movement status (where the person is) — FRS §8.6. */
export type MovementStatus = "draft" | "out" | "returned" | "cancelled";
/** Approval status is tracked separately from movement status. */
export type MovementApproval = "not_required" | "pending" | "approved" | "rejected" | "correction_requested";

export interface MovementCorrection {
  _id?: ObjectId;
  requestedBy: ObjectId;
  requestedByName: string;
  requestedAt: Date;
  reason: string;
  proposedOutTime?: Date;
  proposedInTime?: Date;
  originalOutTime?: Date;
  originalInTime?: Date;
  /** Approval status before the correction was requested (restored on rejection). */
  previousApprovalStatus?: MovementApproval;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: ObjectId;
  reviewedByName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
}

export interface IMovement {
  _id: ObjectId;
  movementNo: string;
  user: ObjectId;
  date: string;
  outTime?: Date;
  expectedReturn?: Date;
  inTime?: Date;
  /** Final duration in minutes; only set once In-Time is recorded or the record is resolved. */
  durationMinutes?: number;
  category: string;
  categoryLabel: string;
  official: boolean;
  purpose: string;
  destination?: string;
  project?: ObjectId;
  client?: ObjectId;
  remarks?: string;
  status: MovementStatus;
  approvalStatus: MovementApproval;
  approver?: ObjectId;
  approvedBy?: ObjectId;
  approvedByName?: string;
  approvedAt?: Date;
  approvalNote?: string;
  /** "live" = recorded at the time; "alternative" = entered afterwards by the person or an authorised user (§8.4). */
  entryMode: "live" | "alternative";
  enteredBy?: ObjectId;
  enteredByName?: string;
  alternativeReason?: string;
  resolvedBy?: ObjectId;
  resolvedByName?: string;
  resolutionNote?: string;
  overdueNotifiedAt?: Date;
  corrections: MovementCorrection[];
  history: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const CorrectionSchema = new Schema<MovementCorrection>({
  requestedBy: { type: ObjectIdType, ref: "User", required: true },
  requestedByName: String,
  requestedAt: { type: Date, default: Date.now },
  reason: { type: String, required: true, maxlength: 1000 },
  proposedOutTime: Date,
  proposedInTime: Date,
  originalOutTime: Date,
  originalInTime: Date,
  previousApprovalStatus: String,
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  reviewedBy: { type: ObjectIdType, ref: "User" },
  reviewedByName: String,
  reviewedAt: Date,
  reviewNote: String,
});

const MovementSchema = new Schema<IMovement>(
  {
    movementNo: { type: String, required: true, unique: true },
    user: { type: ObjectIdType, ref: "User", required: true, index: true },
    date: { type: String, required: true, index: true },
    outTime: Date,
    expectedReturn: Date,
    inTime: Date,
    durationMinutes: Number,
    category: { type: String, required: true },
    categoryLabel: { type: String, required: true },
    official: { type: Boolean, default: true },
    purpose: { type: String, required: true, maxlength: 500 },
    destination: { type: String, maxlength: 300 },
    project: { type: ObjectIdType, ref: "Project" },
    client: { type: ObjectIdType, ref: "Client" },
    remarks: { type: String, maxlength: 1000 },
    status: { type: String, enum: ["draft", "out", "returned", "cancelled"], default: "out", index: true },
    approvalStatus: {
      type: String,
      enum: ["not_required", "pending", "approved", "rejected", "correction_requested"],
      default: "not_required",
      index: true,
    },
    approver: { type: ObjectIdType, ref: "User" },
    approvedBy: { type: ObjectIdType, ref: "User" },
    approvedByName: String,
    approvedAt: Date,
    approvalNote: String,
    entryMode: { type: String, enum: ["live", "alternative"], default: "live" },
    enteredBy: { type: ObjectIdType, ref: "User" },
    enteredByName: String,
    alternativeReason: String,
    resolvedBy: { type: ObjectIdType, ref: "User" },
    resolvedByName: String,
    resolutionNote: String,
    overdueNotifiedAt: Date,
    corrections: { type: [CorrectionSchema], default: [] },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);
MovementSchema.index({ user: 1, date: 1 });
MovementSchema.index({ status: 1, expectedReturn: 1 });

export const Movement = defineModel<IMovement>("Movement", MovementSchema);
