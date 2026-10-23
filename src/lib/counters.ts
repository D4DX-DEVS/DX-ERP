import "server-only";
import { connectDB } from "@/lib/db";
import { Counter } from "@/lib/models";
import { monthKey } from "@/lib/time";

/** Atomically increments and returns the next value of a named sequence. */
export async function nextSeq(name: string): Promise<number> {
  await connectDB();
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return doc!.seq;
}

/** e.g. nextNumber("movement", "MOV-", 6) → "MOV-000124" */
export async function nextNumber(name: string, prefix: string, pad = 4): Promise<string> {
  const seq = await nextSeq(name);
  return `${prefix}${String(seq).padStart(pad, "0")}`;
}

/** Indian fiscal year label for a date, e.g. "2026-27" (April–March). */
export function fiscalYear(date = new Date()): string {
  const [y, m] = monthKey(date).split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Standard human-readable ID prefixes used across modules. */
export const ID_PREFIX = {
  employee: "EMP-",
  trainee: "TRN-",
  intern: "INT-",
  admin: "ADM-",
  movement: "MOV-",
  leave: "LV-",
  project: "PRJ-",
  task: "TSK-",
  issue: "BUG-",
  client: "CLT-",
  lead: "LEAD-",
  contract: "CTR-",
  invoiceDraft: "DRAFT-",
  payment: "PAY-",
  expense: "EXP-",
  asset: "AST-",
  payroll: "PR-",
} as const;
