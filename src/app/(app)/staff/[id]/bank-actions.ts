"use server";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { can } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { BankAccount, StoredFile, User, newId, type BankDocument, type IBankAccount } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { inList, jsonPush } from "@/lib/sql";
import { getSettings } from "@/lib/settings";
import { isObjectId, zs } from "@/lib/validation";
import { autoCompleteSteps } from "../_lib/person";
import { documentActor } from "../_lib/document-actor";
import {
  ACCOUNT_NUMBER_PATTERN,
  BANK_ACCOUNT_TYPES,
  BANK_DOCUMENT_TYPES,
  BANK_FILE_CATEGORY,
  IFSC_PATTERN,
  bankDocumentTypeLabel,
  maskAccount,
  selfBankEditable,
} from "../_lib/bank";

const MAX_ACCOUNTS = 5;
const MAX_DOCUMENTS = 10;

/**
 * Bank details are confidential: HR who may edit the record *and* see confidential data, or the person themself when the
 * bank category is open to them — the same rule as uploading that document category (see selfBankEditable).
 */
async function bankActor(personId: string) {
  const actor = await documentActor(personId);
  const manage = actor.manage && can(actor.user, "staff.confidential");
  const settings = await getSettings();
  if (!manage && !(actor.self && selfBankEditable(settings.documentCategories, actor.target.documentUploadOpen))) {
    throw new ActionError(actor.self ? "Bank details are restricted — please hand them to HR, or ask HR to open document upload for you." : "You don't have permission to manage bank details.");
  }
  return { ...actor, manage };
}

async function loadAccounts(personId: string) {
  return db().select().from(BankAccount).where(eq(BankAccount.user, personId));
}

function findAccount(accounts: IBankAccount[], id: string) {
  const account = isObjectId(id) ? accounts.find((a) => a._id === id) : undefined;
  if (!account) throw new ActionError("Bank account not found.");
  return account;
}

type SalaryFields = Pick<IBankAccount, "accountHolder" | "accountNumber" | "ifsc" | "bankName">;

/** Keeps `User.bank` (read by payroll and the bank transfer file) in step with the salary account. PAN / UAN stored there are left alone. */
function mirrorSalaryAccount(personId: string, account: SalaryFields | null) {
  const current = sql`case when json_type(${User.bank}) = 'object' then ${User.bank} else '{}' end`;
  const bank = account
    ? sql`json_set(${current}, '$.accountName', ${account.accountHolder}, '$.accountNumber', ${account.accountNumber}, '$.ifsc', ${account.ifsc}, '$.bankName', ${account.bankName})`
    : sql`json_remove(${current}, '$.accountName', '$.accountNumber', '$.ifsc', '$.bankName')`;
  return db().update(User).set({ bank }).where(eq(User._id, personId));
}

/** Makes `id` the only salary account of the person (two writes, meant for a batch). */
function salaryAccountWrites(personId: string, id: string, account: SalaryFields) {
  return [
    db()
      .update(BankAccount)
      .set({ isPrimary: false })
      .where(and(eq(BankAccount.user, personId), ne(BankAccount._id, id), eq(BankAccount.isPrimary, true))),
    mirrorSalaryAccount(personId, account),
  ] as const;
}

/** A person who changes their own salary account themself: payroll checks it before the next run. */
async function alertPayroll(actorId: string, target: { _id: string; name: string }, account: SalaryFields) {
  await notifyPermission(
    "payroll.prepare",
    {
      type: "payroll",
      title: "Salary account changed",
      body: `${target.name} set ${account.bankName} ${maskAccount(account.accountNumber)} as their salary account. Check it against the passbook before the next payroll run.`,
      link: `/staff/${target._id}?tab=documents#bank`,
    },
    [actorId],
  );
}

const digitsOnly = (v: unknown) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v);

const accountSchema = z.object({
  personId: zs.id("Person"),
  id: zs.optId(),
  accountHolder: zs.text("Account holder name", 120),
  bankName: zs.text("Bank name", 120),
  branch: zs.optText(120),
  accountNumber: z.preprocess(digitsOnly, z.string({ error: "Account number is required" }).min(1, "Account number is required").regex(ACCOUNT_NUMBER_PATTERN, "Enter 6–20 digits")),
  confirmAccountNumber: z.preprocess(digitsOnly, z.string().optional()),
  ifsc: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.string({ error: "IFSC is required" }).min(1, "IFSC is required").regex(IFSC_PATTERN, "Enter the 11-character IFSC, e.g. SBIN0001234"),
  ),
  accountType: z.preprocess((v) => (v === "" || v == null ? "savings" : v), z.enum(BANK_ACCOUNT_TYPES.map((t) => t.key) as ["savings", "current", "salary"])),
  primary: zs.bool(),
});

/** Adds or edits a bank account. The first account becomes the salary account; ticking "salary account" moves it. */
export async function saveBankAccount(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = parse(accountSchema, input);
    if (data.confirmAccountNumber !== data.accountNumber) throw new ActionError("The account numbers don't match.", { confirmAccountNumber: "Doesn't match the account number" });
    const { user, target, self } = await bankActor(data.personId);
    const accounts = await loadAccounts(target._id);
    const existing = data.id ? findAccount(accounts, data.id) : undefined;
    if (accounts.some((a) => a._id !== existing?._id && a.accountNumber === data.accountNumber && a.ifsc === data.ifsc)) {
      throw new ActionError("This account is already on the record.", { accountNumber: "Already added" });
    }
    if (!existing && accounts.length >= MAX_ACCOUNTS) throw new ActionError(`A person can have at most ${MAX_ACCOUNTS} bank accounts.`);

    const primary = Boolean(existing?.isPrimary) || data.primary || !accounts.some((a) => a.isPrimary);
    const values = {
      accountHolder: data.accountHolder,
      bankName: data.bankName,
      branch: data.branch ?? null,
      accountNumber: data.accountNumber,
      ifsc: data.ifsc,
      accountType: data.accountType,
      isPrimary: primary,
    };
    const id = existing?._id ?? newId();
    const write = existing
      ? db().update(BankAccount).set(values).where(eq(BankAccount._id, id))
      : db()
          .insert(BankAccount)
          .values({ _id: id, ...values, user: target._id, documents: [], createdBy: user._id });
    await db().batch([write, ...(primary ? salaryAccountWrites(target._id, id, values) : [])]);

    const label = `${data.bankName} ${maskAccount(data.accountNumber)}`;
    const masked = (a: Partial<typeof values>) => ({ ...a, accountNumber: a.accountNumber ? maskAccount(a.accountNumber) : a.accountNumber });
    await audit(user, {
      action: existing ? "update" : "create",
      entity: "bank_account",
      entityId: id,
      ref: target.employeeId,
      summary: `${existing ? "Updated" : "Added"} ${target.name}'s bank account: ${label}${primary ? " (salary account)" : ""}`,
      changes: existing ? diff(masked(existing), masked(values), ["accountHolder", "bankName", "branch", "accountNumber", "ifsc", "accountType", "isPrimary"]) : undefined,
    });
    const salaryChanged = primary && (!existing?.isPrimary || existing.accountNumber !== data.accountNumber || existing.ifsc !== data.ifsc);
    if (self && salaryChanged) await alertPayroll(user._id, target, values);
    if (!self) {
      await notify([target._id], { type: "document", title: existing ? "Your bank details were updated" : "A bank account was added to your record", body: `${label}${primary ? " · salary account" : ""}`, link: "/profile#bank" }, [user._id]);
    }
    return { id };
  }, "Bank account saved");
}

/** Makes an account the salary account payroll pays into. */
export async function setSalaryAccount(personId: string, id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, target, self } = await bankActor(personId);
    const account = findAccount(await loadAccounts(target._id), id);
    if (account.isPrimary) return null;
    await db().batch([db().update(BankAccount).set({ isPrimary: true }).where(eq(BankAccount._id, account._id)), ...salaryAccountWrites(target._id, account._id, account)]);
    const label = `${account.bankName} ${maskAccount(account.accountNumber)}`;
    await audit(user, { action: "update", entity: "bank_account", entityId: account._id, ref: target.employeeId, summary: `Made ${label} ${target.name}'s salary account` });
    if (self) await alertPayroll(user._id, target, account);
    else await notify([target._id], { type: "document", title: "Your salary account was changed", body: label, link: "/profile#bank" }, [user._id]);
    return null;
  }, "Salary account updated");
}

/** Deletes an account and its proof files. The person may delete an account only while every document on it is their own upload. */
export async function deleteBankAccount(personId: string, id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, target, self, manage } = await bankActor(personId);
    const accounts = await loadAccounts(target._id);
    const account = findAccount(accounts, id);
    if (!manage && account.documents.some((d) => d.uploadedBy !== user.id)) throw new ActionError("This account has documents uploaded by HR. Ask HR to remove it.");
    // Deleting the salary account hands the role to the most recently added remaining account (or clears payroll's copy).
    const successor = account.isPrimary ? accounts.filter((a) => a._id !== account._id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] : undefined;
    const files = account.documents.map((d) => d.file);
    await db().batch([
      db().delete(BankAccount).where(eq(BankAccount._id, account._id)),
      db()
        .update(StoredFile)
        .set({ deletedAt: new Date(), deletedBy: user._id })
        .where(and(inList(StoredFile._id, files), eq(StoredFile.entityId, target._id), isNull(StoredFile.deletedAt))),
      ...(successor ? [db().update(BankAccount).set({ isPrimary: true }).where(eq(BankAccount._id, successor._id)), mirrorSalaryAccount(target._id, successor)] : []),
      ...(account.isPrimary && !successor ? [mirrorSalaryAccount(target._id, null)] : []),
    ]);
    const label = `${account.bankName} ${maskAccount(account.accountNumber)}`;
    await audit(user, {
      action: "delete",
      entity: "bank_account",
      entityId: account._id,
      ref: target.employeeId,
      summary: `Deleted ${target.name}'s bank account ${label} (${files.length} document${files.length === 1 ? "" : "s"})${successor ? `; salary account is now ${successor.bankName} ${maskAccount(successor.accountNumber)}` : ""}`,
    });
    if (self && successor) await alertPayroll(user._id, target, successor);
    if (!self) await notify([target._id], { type: "document", title: "A bank account was removed from your record", body: label, link: "/profile#bank" }, [user._id]);
    return null;
  }, "Bank account deleted");
}

const documentSchema = z.object({
  personId: zs.id("Person"),
  accountId: zs.id("Bank account"),
  type: z.enum(BANK_DOCUMENT_TYPES.map((t) => t.key) as [string, ...string[]], { error: "Choose the document type" }),
  fileId: zs.ids(),
  note: zs.optText(200),
});

/** Attaches an uploaded file (passbook, cancelled cheque…) to a bank account. Always restricted. */
export async function addBankDocument(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const data = parse(documentSchema, input);
    const { user, target, self } = await bankActor(data.personId);
    const account = findAccount(await loadAccounts(target._id), data.accountId);
    const fileId = data.fileId[0];
    if (!fileId) throw new ActionError("Attach a file first.", { fileId: "Attach a file" });
    if (account.documents.length >= MAX_DOCUMENTS) throw new ActionError(`A bank account can have at most ${MAX_DOCUMENTS} documents.`);

    const [file] = await db().select().from(StoredFile).where(eq(StoredFile._id, fileId)).limit(1);
    if (!file || file.deletedAt || file.entityType !== "user" || file.entityId !== target._id) throw new ActionError("Uploaded file not found. Please upload it again.", { fileId: "Upload again" });
    if (file.uploadedBy !== user.id) throw new ActionError("You can only attach files you uploaded.");
    if (file.category) throw new ActionError("This file is already registered.");

    const label = `${bankDocumentTypeLabel(data.type)} · ${account.bankName} ${maskAccount(account.accountNumber)}`;
    const document: BankDocument = {
      _id: newId(),
      type: data.type,
      file: file._id,
      name: file.name,
      size: file.size,
      mime: file.mime,
      note: data.note,
      uploadedAt: new Date(),
      uploadedBy: user._id,
      uploadedByName: user.name,
    };
    await db().batch([
      db().update(StoredFile).set({ category: BANK_FILE_CATEGORY, confidential: true, notes: label.slice(0, 500) }).where(eq(StoredFile._id, file._id)),
      db()
        .update(BankAccount)
        .set({ documents: jsonPush(BankAccount.documents, document) })
        .where(eq(BankAccount._id, account._id)),
    ]);
    await autoCompleteSteps(target._id);
    await audit(user, { action: "create", entity: "bank_account", entityId: account._id, ref: target.employeeId, summary: `Uploaded ${label} for ${target.name}` });
    if (!self) await notify([target._id], { type: "document", title: "A bank document was added to your record", body: label, link: "/profile#bank" }, [user._id]);
    return null;
  }, "Document saved");
}

/** Removes one proof document (HR, or the person for a file they uploaded). */
export async function removeBankDocument(personId: string, accountId: string, documentId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, target, manage } = await bankActor(personId);
    const account = findAccount(await loadAccounts(target._id), accountId);
    const doc = account.documents.find((d) => d._id === documentId);
    if (!doc) throw new ActionError("Document not found.");
    if (!manage && doc.uploadedBy !== user.id) throw new ActionError("Only HR can remove a document they uploaded.");
    // Guarded on the account being unchanged since it was read, so a concurrent upload is never lost.
    const updated = await db()
      .update(BankAccount)
      .set({ documents: account.documents.filter((d) => d._id !== documentId) })
      .where(and(eq(BankAccount._id, account._id), eq(BankAccount.updatedAt, account.updatedAt)))
      .returning({ id: BankAccount._id });
    if (updated.length === 0) throw new ActionError("This account was just changed. Reload and try again.");
    await db().update(StoredFile).set({ deletedAt: new Date(), deletedBy: user._id }).where(and(eq(StoredFile._id, doc.file), eq(StoredFile.entityId, target._id)));
    await audit(user, {
      action: "delete",
      entity: "bank_account",
      entityId: account._id,
      ref: target.employeeId,
      summary: `Removed ${bankDocumentTypeLabel(doc.type)} (“${doc.name}”) from ${target.name}'s ${account.bankName} ${maskAccount(account.accountNumber)}`,
    });
    return null;
  }, "Document removed");
}
