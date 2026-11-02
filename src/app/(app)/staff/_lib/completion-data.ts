import "server-only";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BankAccount, Education, StoredFile } from "@/lib/models";
import type { AppSettings } from "@/lib/config-defaults";
import { BANK_PROOF_TYPES } from "./bank";
import { profileCompletion, type CompletionFacts, type ProfileCompletion } from "./completion";

/**
 * A person's profile completion. Reads only whether documents and bank proofs exist — never their contents — so it may be
 * shown to anyone who can see the person's personal details.
 */
export async function loadProfileCompletion(person: CompletionFacts["person"] & { _id: string }, settings: AppSettings): Promise<ProfileCompletion> {
  const [files, education, bank] = await Promise.all([
    db()
      .selectDistinct({ category: StoredFile.category })
      .from(StoredFile)
      .where(
        and(
          eq(StoredFile.entityType, "user"),
          eq(StoredFile.entityId, person._id),
          isNull(StoredFile.deletedAt),
          isNull(StoredFile.replacedBy),
          isNotNull(StoredFile.category),
          ne(StoredFile.category, ""),
        ),
      ),
    db()
      .select({ level: Education.level, qualification: Education.qualification, certificates: sql<number>`json_array_length(${Education.certificates})` })
      .from(Education)
      .where(eq(Education.user, person._id)),
    db().select({ primary: BankAccount.isPrimary, documents: BankAccount.documents }).from(BankAccount).where(eq(BankAccount.user, person._id)),
  ]);
  return profileCompletion(
    {
      person,
      documentCategories: files.map((f) => f.category!),
      education,
      bank: bank.map((b) => ({ primary: b.primary, hasProof: b.documents.some((d) => BANK_PROOF_TYPES.includes(d.type)) })),
    },
    settings.documentCategories,
  );
}
