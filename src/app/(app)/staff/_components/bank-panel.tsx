"use client";

import { useState } from "react";
import { Landmark, Lock, Pencil, Plus, Star, Trash2, Upload } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Tag } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { addBankDocument, deleteBankAccount, removeBankDocument, saveBankAccount, setSalaryAccount } from "../[id]/bank-actions";
import { BANK_ACCOUNT_TYPES, BANK_DOCUMENT_TYPES, BANK_PROOF_TYPES, bankAccountTypeLabel, bankDocumentTypeLabel, maskAccount } from "../_lib/bank";
import type { BankAccountView } from "../_lib/bank-data";
import { FileTile, MissingTile } from "./file-tile";

/** "123456789012" → "1234 5678 9012" (easier to read back against a passbook). */
const grouped = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");

/**
 * Structured bank details: each account is typed in (holder, number, IFSC…), then its passbook front page or a
 * cancelled cheque is uploaded on it. The salary account is the one payroll pays into.
 */
export function BankPanel({
  personId,
  holderName,
  accounts,
  canEdit,
  manage,
  lockedNote,
}: {
  personId: string;
  /** Prefills the account holder of a new account. */
  holderName: string;
  accounts: BankAccountView[];
  canEdit: boolean;
  manage: boolean;
  /** Shown instead of the add button when the viewer may not edit (e.g. HR hasn't opened restricted uploads). */
  lockedNote?: string;
}) {
  const documentCount = accounts.reduce((n, a) => n + a.documents.length, 0);
  return (
    <Card id="bank" className="@container scroll-mt-20">
      <CardHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Bank details
            <Tag tone="gray" className="gap-1 bg-navy text-white">
              <Lock className="size-3" /> Restricted
            </Tag>
          </span>
        }
        subtitle={
          accounts.length
            ? `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"} · ${documentCount} ${documentCount === 1 ? "document" : "documents"}`
            : "Salary account with its passbook or cancelled cheque"
        }
        action={canEdit ? <AccountDialog personId={personId} holderName={holderName} hasSalaryAccount={accounts.some((a) => a.primary)} /> : undefined}
      />
      {!canEdit && lockedNote && accounts.length > 0 && <p className="px-5 pb-2 text-[13px] text-muted">{lockedNote}</p>}
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Landmark className="size-5" />}
          title="No bank account added yet"
          description={canEdit ? "Type in the account details — holder name, account number and IFSC — then upload the passbook front page or a cancelled cheque." : lockedNote}
        />
      ) : (
        <ul className="pb-2">
          {accounts.map((a) => (
            <AccountRow key={a.id} personId={personId} holderName={holderName} account={a} canEdit={canEdit} manage={manage} hasSalaryAccount={accounts.some((x) => x.primary)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AccountRow({
  personId,
  holderName,
  account: a,
  canEdit,
  manage,
  hasSalaryAccount,
}: {
  personId: string;
  holderName: string;
  account: BankAccountView;
  canEdit: boolean;
  manage: boolean;
  hasSalaryAccount: boolean;
}) {
  const proof = a.documents.find((d) => BANK_PROOF_TYPES.includes(d.type));
  const canDelete = manage || a.documents.every((d) => d.mine);
  const label = `${a.bankName} ${maskAccount(a.accountNumber)}`;
  const details = [
    { label: "Account holder", value: a.accountHolder },
    { label: "Account number", value: <span className="font-mono tabular">{grouped(a.accountNumber)}</span> },
    { label: "IFSC", value: <span className="font-mono">{a.ifsc}</span> },
    { label: "Branch", value: a.branch || "—" },
  ];
  return (
    <li className="border-t border-line-soft px-4 py-3.5 first:border-t-0 sm:px-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-2">
            {a.primary && <Tag tone="green">Salary account</Tag>}
            <span className="font-display text-sm font-semibold break-words text-ink">{a.bankName}</span>
            <span className="text-xs text-muted">{bankAccountTypeLabel(a.accountType)}</span>
          </div>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {details.map((d) => (
              <div key={d.label} className="min-w-0">
                <dt className="text-[11px] font-medium text-muted">{d.label}</dt>
                <dd className="text-[13px] break-words text-ink">{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <DocumentDialog personId={personId} account={a} />
            {!a.primary && (
              <ActionButton
                variant="ghost"
                size="icon-sm"
                aria-label={`Make ${label} the salary account`}
                title="Make salary account"
                action={() => setSalaryAccount(personId, a.id)}
                confirmTitle="Change salary account"
                confirmLabel="Make salary account"
                confirm={`Pay salary into ${label} from the next payroll run?`}
                successMessage="Salary account updated"
              >
                <Star className="size-4 text-subtle" />
              </ActionButton>
            )}
            <AccountDialog personId={personId} holderName={holderName} hasSalaryAccount={hasSalaryAccount} account={a} />
            {canDelete && (
              <ActionButton
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${label}`}
                title="Delete bank account"
                action={() => deleteBankAccount(personId, a.id)}
                confirmTone="danger"
                confirmTitle="Delete bank account"
                confirmLabel="Delete"
                confirm={`Delete ${label}${a.documents.length ? ` and its ${a.documents.length} document${a.documents.length === 1 ? "" : "s"}` : ""}?${a.primary ? " It is the salary account — another account (if any) takes its place." : ""}`}
                successMessage="Bank account deleted"
              >
                <Trash2 className="size-4 text-subtle" />
              </ActionButton>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-2 @2xl:grid-cols-2">
        {a.documents.map((d) => (
          <FileTile
            key={d.id}
            title={bankDocumentTypeLabel(d.type)}
            file={d.file}
            name={d.name}
            size={d.size}
            uploadedAt={d.uploadedAt}
            uploadedByName={d.uploadedByName}
            note={d.note}
            actions={
              canEdit && (manage || d.mine) ? (
                <ActionButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${d.name}`}
                  title="Remove document"
                  action={() => removeBankDocument(personId, a.id, d.id)}
                  confirmTone="danger"
                  confirmTitle="Remove document"
                  confirmLabel="Remove"
                  confirm={`Remove “${d.name}” (${bankDocumentTypeLabel(d.type)})?`}
                  successMessage="Document removed"
                >
                  <Trash2 className="size-4 text-subtle" />
                </ActionButton>
              ) : undefined
            }
          />
        ))}
        {!proof && (
          <MissingTile
            title="Passbook front page or cancelled cheque"
            hint="Proof not uploaded"
            tone="warning"
            action={canEdit ? <DocumentDialog personId={personId} account={a} slot /> : undefined}
          />
        )}
      </div>
    </li>
  );
}

/** Add (no `account`) or edit a bank account. */
function AccountDialog({ personId, holderName, hasSalaryAccount, account }: { personId: string; holderName: string; hasSalaryAccount: boolean; account?: BankAccountView }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title={account ? "Edit bank account" : "Add bank account"}
      description={account ? `${account.bankName} ${maskAccount(account.accountNumber)}` : "Type the details exactly as they appear on the passbook. Upload the passbook or a cancelled cheque after saving."}
      trigger={
        account ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${account.bankName} ${maskAccount(account.accountNumber)}`} title="Edit bank account">
            <Pencil className="size-4 text-subtle" />
          </Button>
        ) : (
          <Button variant="secondary" icon={<Plus className="size-4" />}>
            <span className="max-sm:sr-only">Add bank account</span>
          </Button>
        )
      }
    >
      <ActionForm action={saveBankAccount} values={{ personId, ...(account ? { id: account.id } : {}) }} successMessage="Bank account saved" onSuccess={() => setOpen(false)} className="gap-4">
        <FormGrid>
          <Field label="Account holder name" name="accountHolder" required hint="As printed on the passbook" className="sm:col-span-2">
            <Input id="accountHolder" name="accountHolder" maxLength={120} defaultValue={account?.accountHolder ?? holderName} autoComplete="off" />
          </Field>
          <Field label="Bank name" name="bankName" required>
            <Input id="bankName" name="bankName" maxLength={120} defaultValue={account?.bankName} placeholder="e.g. State Bank of India" autoComplete="off" />
          </Field>
          <Field label="Branch" name="branch">
            <Input id="branch" name="branch" maxLength={120} defaultValue={account?.branch} placeholder="e.g. Kozhikode Main" autoComplete="off" />
          </Field>
          <Field label="Account number" name="accountNumber" required>
            <Input id="accountNumber" name="accountNumber" inputMode="numeric" maxLength={24} defaultValue={account?.accountNumber} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Re-enter account number" name="confirmAccountNumber" required>
            <Input
              id="confirmAccountNumber"
              name="confirmAccountNumber"
              inputMode="numeric"
              maxLength={24}
              defaultValue={account?.accountNumber}
              autoComplete="off"
              spellCheck={false}
              onPaste={(e) => e.preventDefault()}
            />
          </Field>
          <Field label="IFSC" name="ifsc" required hint="11 characters, e.g. SBIN0001234">
            <Input
              id="ifsc"
              name="ifsc"
              maxLength={11}
              defaultValue={account?.ifsc}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="uppercase"
            />
          </Field>
          <Field label="Account type" name="accountType">
            <Select id="accountType" name="accountType" defaultValue={account?.accountType ?? "savings"}>
              {BANK_ACCOUNT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
        {account?.primary ? (
          <p className="text-[13px] text-muted">This is the salary account — payroll pays into it.</p>
        ) : hasSalaryAccount ? (
          <Checkbox name="primary" label="Make this the salary account (payroll pays into it)" />
        ) : (
          <p className="text-[13px] text-muted">This becomes the salary account — payroll pays into it.</p>
        )}
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>{account ? "Save changes" : "Save bank account"}</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/**
 * Upload a passbook page, cancelled cheque or other proof to an account. The missing proof type is preselected; `slot`
 * renders the compact "Upload" trigger of the empty proof slot.
 */
function DocumentDialog({ personId, account, slot }: { personId: string; account: BankAccountView; slot?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasProof = account.documents.some((d) => BANK_PROOF_TYPES.includes(d.type));
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Upload bank document"
      description={`${account.bankName} ${maskAccount(account.accountNumber)} · only you and authorised HR can open it`}
      trigger={
        <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" />}>
          <span className="max-sm:sr-only">{slot ? "Upload" : hasProof ? "Document" : "Passbook"}</span>
        </Button>
      }
    >
      <ActionForm action={addBankDocument} values={{ personId, accountId: account.id }} successMessage="Document saved" onSuccess={() => setOpen(false)} className="gap-4">
        <Field label="Document type" name="type" required>
          <Select id="type" name="type" defaultValue={hasProof ? "" : "passbook"}>
            <option value="" disabled>
              Select type
            </option>
            {BANK_DOCUMENT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="File" name="fileId" required hint="A clear photo or scan showing the name, account number and IFSC">
          <FileUpload name="fileId" multiple={false} label="Choose file" accept="image/*,application/pdf" context={{ entityType: "user", entityId: personId, confidential: true }} />
        </Field>
        <Field label="Note" name="note">
          <Input id="note" name="note" maxLength={200} placeholder="Optional" />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save document</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
