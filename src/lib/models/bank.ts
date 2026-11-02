import { index, sqliteTable } from "drizzle-orm/sqlite-core";
import { bool, json, pk, ref, text, timestamps, type Id } from "./_base";

/** A proof file for one bank account (passbook front page, cancelled cheque, statement, …). */
export interface BankDocument {
  _id: Id;
  /** Key from BANK_DOCUMENT_TYPES (staff/_lib/bank.ts). */
  type: string;
  /** StoredFile id (entityType "user", category "bank_record", always confidential). */
  file: Id;
  name: string;
  size?: number;
  mime?: string;
  note?: string;
  uploadedAt: Date;
  uploadedBy?: Id;
  uploadedByName?: string;
}

/**
 * A person's bank account with its proof documents. Confidential: listed only to the person and `staff.confidential`
 * holders. The primary (salary) account is mirrored into `User.bank`, which payroll reads.
 */
export const BankAccount = sqliteTable(
  "bank_accounts",
  {
    _id: pk(),
    user: ref().notNull(),
    /** Name exactly as the bank has it. */
    accountHolder: text().notNull(),
    bankName: text().notNull(),
    branch: text(),
    /** Digits only. */
    accountNumber: text().notNull(),
    /** Upper case, e.g. "SBIN0001234". */
    ifsc: text().notNull(),
    accountType: text().$type<"savings" | "current" | "salary">().notNull().default("savings"),
    /** The salary account payroll pays into — at most one per person. */
    isPrimary: bool().notNull().default(false),
    documents: json<BankDocument[]>()
      .notNull()
      .$defaultFn(() => []),
    createdBy: ref(),
    ...timestamps(),
  },
  (t) => [index("bank_accounts_user").on(t.user)],
);
export type IBankAccount = typeof BankAccount.$inferSelect;
