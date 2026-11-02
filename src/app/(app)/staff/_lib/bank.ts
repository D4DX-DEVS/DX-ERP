/** Client-safe constants for the structured bank accounts (account details + their passbook / cheque proofs). */
import type { DocumentCategory } from "@/lib/config-defaults";

/** Flat document category for bank proofs (still listed when old files exist). */
export const BANK_CATEGORY = "bank";
/** `StoredFile.category` of proof files attached to a bank account. */
export const BANK_FILE_CATEGORY = "bank_record";

export const BANK_ACCOUNT_TYPES: { key: "savings" | "current" | "salary"; label: string }[] = [
  { key: "savings", label: "Savings" },
  { key: "salary", label: "Salary" },
  { key: "current", label: "Current" },
];

export const BANK_DOCUMENT_TYPES: { key: string; label: string }[] = [
  { key: "passbook", label: "Passbook front page" },
  { key: "cancelled_cheque", label: "Cancelled cheque" },
  { key: "statement", label: "Bank statement" },
  { key: "bank_letter", label: "Account opening / bank letter" },
  { key: "other", label: "Other" },
];

/** Either of these proves the account details (one is enough). */
export const BANK_PROOF_TYPES = ["passbook", "cancelled_cheque"];

/** Indian Financial System Code: 4 letters, a zero, 6 letters or digits. */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Account numbers are digits only (spaces / hyphens are stripped first). */
export const ACCOUNT_NUMBER_PATTERN = /^\d{6,20}$/;

export function bankAccountTypeLabel(key: string): string {
  return BANK_ACCOUNT_TYPES.find((t) => t.key === key)?.label ?? key;
}

export function bankDocumentTypeLabel(key: string): string {
  return BANK_DOCUMENT_TYPES.find((t) => t.key === key)?.label ?? key;
}

/**
 * Whether the person may type in their own bank details: the "bank" document category is not restricted in Configuration,
 * or HR opened restricted uploads for them (User.documentUploadOpen). Viewing stays limited to them and staff.confidential.
 */
export function selfBankEditable(categories: DocumentCategory[], uploadOpen: boolean): boolean {
  return uploadOpen || categories.find((c) => c.key === BANK_CATEGORY)?.confidential === false;
}

/** "•••• 4321" — for summaries, audit lines and notifications. */
export function maskAccount(accountNumber: string): string {
  return `•••• ${accountNumber.slice(-4)}`;
}
