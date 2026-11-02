import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { BankAccount } from "@/lib/models";

/** Plain view model of one bank account (safe to pass to client components — only for viewers allowed to see it). */
export interface BankAccountView {
  id: string;
  accountHolder: string;
  bankName: string;
  branch?: string;
  accountNumber: string;
  ifsc: string;
  accountType: "savings" | "current" | "salary";
  primary: boolean;
  documents: { id: string; type: string; file: string; name: string; size?: number; note?: string; uploadedAt: string; uploadedByName?: string; mine: boolean }[];
}

/**
 * A person's bank accounts, salary account first. Confidential: call only for the person themself or a
 * `staff.confidential` holder. `viewerId` marks the viewer's own uploads.
 */
export async function loadBankAccounts(personId: string, viewerId: string): Promise<BankAccountView[]> {
  const rows = await db().select().from(BankAccount).where(eq(BankAccount.user, personId));
  return rows
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => ({
      id: r._id,
      accountHolder: r.accountHolder,
      bankName: r.bankName,
      branch: r.branch ?? undefined,
      accountNumber: r.accountNumber,
      ifsc: r.ifsc,
      accountType: r.accountType,
      primary: r.isPrimary,
      documents: r.documents.map((d) => ({
        id: d._id,
        type: d.type,
        file: d.file,
        name: d.name,
        size: d.size,
        note: d.note,
        uploadedAt: new Date(d.uploadedAt).toISOString(),
        uploadedByName: d.uploadedByName,
        mine: d.uploadedBy === viewerId,
      })),
    }));
}
