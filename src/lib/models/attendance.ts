import { defineModel, HistorySchema, ObjectIdType, Schema, type HistoryEntry, type ObjectId } from "./_base";

export type AttendanceStatus = "present" | "half_day" | "absent" | "on_leave" | "holiday" | "weekend";

export interface BreakEntry {
  _id?: ObjectId;
  start: Date;
  end?: Date;
}

export interface IAttendance {
  _id: ObjectId;
  user: ObjectId;
  date: string;
  checkIn?: Date;
  checkOut?: Date;
  breaks: BreakEntry[];
  breakMinutes: number;
  /** Net working minutes = (checkOut − checkIn) − breaks − deducted personal movement time (per policy). */
  workMinutes: number;
  movementMinutes: number;
  status: AttendanceStatus;
  late: boolean;
  lateMinutes: number;
  earlyDeparture: boolean;
  earlyMinutes: number;
  missingCheckout: boolean;
  source: "self" | "manual" | "correction" | "system";
  remarks?: string;
  locked: boolean;
  history: HistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    user: { type: ObjectIdType, ref: "User", required: true },
    date: { type: String, required: true },
    checkIn: Date,
    checkOut: Date,
    breaks: { type: [new Schema<BreakEntry>({ start: { type: Date, required: true }, end: Date })], default: [] },
    breakMinutes: { type: Number, default: 0 },
    workMinutes: { type: Number, default: 0 },
    movementMinutes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["present", "half_day", "absent", "on_leave", "holiday", "weekend"],
      default: "present",
    },
    late: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    earlyDeparture: { type: Boolean, default: false },
    earlyMinutes: { type: Number, default: 0 },
    missingCheckout: { type: Boolean, default: false },
    source: { type: String, enum: ["self", "manual", "correction", "system"], default: "self" },
    remarks: String,
    locked: { type: Boolean, default: false },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true },
);
AttendanceSchema.index({ user: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ date: 1, status: 1 });

export const Attendance = defineModel<IAttendance>("Attendance", AttendanceSchema);

export interface IAttendanceCorrection {
  _id: ObjectId;
  user: ObjectId;
  date: string;
  attendance?: ObjectId;
  requestedCheckIn?: Date;
  requestedCheckOut?: Date;
  original: { checkIn?: Date; checkOut?: Date; status?: string };
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewer?: ObjectId;
  reviewerName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  createdAt: Date;
}

const AttendanceCorrectionSchema = new Schema<IAttendanceCorrection>(
  {
    user: { type: ObjectIdType, ref: "User", required: true, index: true },
    date: { type: String, required: true },
    attendance: { type: ObjectIdType, ref: "Attendance" },
    requestedCheckIn: Date,
    requestedCheckOut: Date,
    original: { checkIn: Date, checkOut: Date, status: String },
    reason: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending", index: true },
    reviewer: { type: ObjectIdType, ref: "User" },
    reviewerName: String,
    reviewedAt: Date,
    reviewNote: String,
  },
  { timestamps: true },
);

export const AttendanceCorrection = defineModel<IAttendanceCorrection>("AttendanceCorrection", AttendanceCorrectionSchema);
