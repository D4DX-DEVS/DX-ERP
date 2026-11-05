import { customType, integer, real, text } from "drizzle-orm/sqlite-core";

/**
 * Record ids are 24-hex strings in MongoDB ObjectId format, so ids migrated from MongoDB (and every
 * URL that contains one) keep working, and `isObjectId()` still validates them.
 */
export type Id = string;

let idCounter = Math.floor(Math.random() * 0xffffff);

/** New id: 4-byte seconds timestamp + 5 random bytes + 3-byte counter (same layout as ObjectId). */
export function newId(): Id {
  const seconds = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0");
  const random = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
  idCounter = (idCounter + 1) % 0x1000000;
  return seconds + random + idCounter.toString(16).padStart(6, "0");
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Parses a JSON column, turning ISO timestamps (how Dates are serialised) back into Date objects. */
export function parseJson(value: string): unknown {
  return JSON.parse(value, (_key, v) => (typeof v === "string" && ISO_TIMESTAMP.test(v) ? new Date(v) : v));
}

/**
 * JSON text column for embedded documents, arrays, maps and mixed values. Dates inside are stored as
 * ISO strings and revived on read; `YYYY-MM-DD` date-only strings are left alone.
 */
export function json<T>() {
  return customType<{ data: T; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => parseJson(value) as T,
  })();
}

/** Primary key column. */
export const pk = () => text().primaryKey().$defaultFn(newId);
/** Reference to another record's `_id` (no FK constraint, as with MongoDB). */
export const ref = () => text();
/** Date/time column (epoch milliseconds). */
export const date = () => integer({ mode: "timestamp_ms" });
export const bool = () => integer({ mode: "boolean" });
export const num = () => real();
export const int = () => integer();
export { text };

export const createdAt = () => date().notNull().$defaultFn(() => new Date());
export const updatedAt = () =>
  date()
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());
/** `{ timestamps: true }` equivalent. */
export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/** Embedded file reference (the file itself lives in the StoredFile table / R2). */
export interface FileRef {
  _id?: Id;
  file: Id;
  name: string;
  size?: number;
  mime?: string;
  uploadedAt?: Date;
  uploadedBy?: Id;
}

export interface CommentEntry {
  _id?: Id;
  user: Id;
  userName: string;
  text: string;
  attachments?: FileRef[];
  at: Date;
}

/** Generic per-record change history (task history, issue history, movement corrections, …). */
export interface HistoryEntry {
  _id?: Id;
  action: string;
  by?: Id;
  byName?: string;
  at: Date;
  note?: string;
  from?: string;
  to?: string;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface LineItem {
  _id?: Id;
  description: string;
  quantity: number;
  rate: number;
  taxRate: number;
  /** Tax chosen from Settings → Taxes, and whether it is intra-state GST (CGST + SGST, half each). Invoices only. */
  taxName?: string;
  taxSplit?: boolean;
  amount: number;
}
