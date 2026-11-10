import "server-only";
import { sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "@/lib/db";
import { Invoice, Payment } from "@/lib/models";
import { isUniqueViolation } from "@/lib/sql";

/**
 * Automatic document numbers: invoices INV0001, INV0002 … (taken when issued) and payment receipts PAY0001, PAY0002 …
 * The next number is one more than the highest in use, so the sequence stays in order; numbers typed by hand in other
 * formats before numbering was automatic are left alone and ignored.
 */
const SEQUENCES = {
  invoice: { prefix: "INV", table: Invoice, column: Invoice.invoiceNo },
  receipt: { prefix: "PAY", table: Payment, column: Payment.receiptNo },
} satisfies Record<string, { prefix: string; table: SQLiteTable; column: SQLiteColumn }>;

const DIGITS = 4;

async function nextNumber(kind: keyof typeof SEQUENCES): Promise<string> {
  const { prefix, table, column } = SEQUENCES[kind];
  const start = prefix.length + 1;
  const [row] = await db()
    .select({ n: sql<number | null>`max(cast(substr(${column}, ${start}) as integer))` })
    .from(table)
    .where(sql`${column} glob ${`${prefix}[0-9]*`} and substr(${column}, ${start}) not glob '*[^0-9]*'`);
  return `${prefix}${String((row?.n ?? 0) + 1).padStart(DIGITS, "0")}`;
}

/**
 * Runs `write` with the next free number. Two people saving at the same moment would pick the same one: the loser's
 * write hits the unique index and is retried with the following number.
 */
export async function withNextNumber<T>(kind: keyof typeof SEQUENCES, write: (no: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const no = await nextNumber(kind);
    try {
      return await write(no);
    } catch (error) {
      if (attempt >= 4 || !isUniqueViolation(error)) throw error;
    }
  }
}
