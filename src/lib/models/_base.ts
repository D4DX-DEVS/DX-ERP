import mongoose, { Schema, type Model, Types } from "mongoose";

export { Schema, Types };
export type ObjectId = Types.ObjectId;
export const ObjectIdType = Schema.Types.ObjectId;

/**
 * Registers a model once per process. In development the cached model is replaced so schema
 * edits are picked up on hot reload.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  if (mongoose.models[name]) {
    if (process.env.NODE_ENV === "production") return mongoose.models[name] as Model<T>;
    mongoose.deleteModel(name);
  }
  return mongoose.model<T>(name, schema);
}

/** Embedded file reference (the file itself lives in the StoredFile collection / Spaces). */
export interface FileRef {
  _id?: ObjectId;
  file: ObjectId;
  name: string;
  size?: number;
  mime?: string;
  uploadedAt?: Date;
  uploadedBy?: ObjectId;
}

export const FileRefSchema = new Schema<FileRef>(
  {
    file: { type: ObjectIdType, ref: "StoredFile", required: true },
    name: { type: String, required: true },
    size: Number,
    mime: String,
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: ObjectIdType, ref: "User" },
  },
  { _id: true },
);

export interface CommentEntry {
  _id?: ObjectId;
  user: ObjectId;
  userName: string;
  text: string;
  attachments?: FileRef[];
  at: Date;
}

export const CommentSchema = new Schema<CommentEntry>({
  user: { type: ObjectIdType, ref: "User", required: true },
  userName: { type: String, required: true },
  text: { type: String, required: true, maxlength: 5000 },
  attachments: { type: [FileRefSchema], default: [] },
  at: { type: Date, default: Date.now },
});

/** Generic per-record change history (task history, issue history, movement corrections, …). */
export interface HistoryEntry {
  _id?: ObjectId;
  action: string;
  by?: ObjectId;
  byName?: string;
  at: Date;
  note?: string;
  from?: string;
  to?: string;
}

export const HistorySchema = new Schema<HistoryEntry>({
  action: { type: String, required: true },
  by: { type: ObjectIdType, ref: "User" },
  byName: String,
  at: { type: Date, default: Date.now },
  note: String,
  from: String,
  to: String,
});

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export const AddressSchema = new Schema<Address>(
  { line1: String, line2: String, city: String, state: String, postalCode: String, country: String },
  { _id: false },
);

export interface LineItem {
  _id?: ObjectId;
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
  amount: number;
}

export const LineItemSchema = new Schema<LineItem>({
  description: { type: String, required: true },
  quantity: { type: Number, default: 1, min: 0 },
  rate: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0, min: 0 },
  amount: { type: Number, default: 0 },
});
