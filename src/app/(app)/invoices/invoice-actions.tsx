"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormGrid, FormActions, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { inr } from "@/lib/format";
import { cancelInvoice, deleteDraftInvoice, issueInvoice, recordAdjustment, recordPayment, recordRefund } from "./actions";
import { INVOICE_PAYMENT_METHODS } from "./totals";

export function IssueInvoiceButton({ id }: { id: string }) {
  return (
    <ActionButton action={() => issueInvoice(id)} confirm="Issue this invoice? It gets its final number, the billing details are frozen and it can no longer be edited." successMessage="Invoice issued">
      Issue invoice
    </ActionButton>
  );
}

export function DeleteDraftButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ActionButton variant="danger-outline" action={() => deleteDraftInvoice(id)} confirm="Delete this draft permanently? Drafts that were never issued can be removed safely." successMessage="Draft deleted" onSuccess={() => router.push("/invoices")}>
      Delete draft
    </ActionButton>
  );
}

export function CancelInvoiceButton({ id }: { id: string }) {
  return (
    <ReasonAction
      title="Cancel invoice"
      description="The invoice is kept for the record but no longer counts towards receivables. This cannot be undone."
      label="Reason for cancelling"
      confirmLabel="Cancel invoice"
      confirmVariant="danger"
      action={(reason) => cancelInvoice(id, reason)}
      successMessage="Invoice cancelled"
      trigger={<Button variant="danger-outline">Cancel invoice</Button>}
    />
  );
}

export function RecordPaymentDialog({ id, balance, today, label = "Record payment" }: { id: string; balance: number; today: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title="Record payment"
      description={`Balance due ${inr(balance, true)}. Part payments are fine; the balance is updated automatically.`}
      trigger={<Button>{label}</Button>}
    >
      <ActionForm action={(input) => recordPayment(id, input)} successMessage="Payment recorded" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Amount (₹)" name="amount" required>
            <Input id="amount" name="amount" type="number" inputMode="decimal" min={0.01} max={balance} step="0.01" defaultValue={balance} />
          </Field>
          <Field label="Date" name="date" required>
            <Input id="date" name="date" type="date" max={today} defaultValue={today} />
          </Field>
          <Field label="Method" name="method" required>
            <Select id="method" name="method" defaultValue={INVOICE_PAYMENT_METHODS[0]}>
              {INVOICE_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" name="reference">
            <Input id="reference" name="reference" placeholder="UTR / cheque no." maxLength={120} />
          </Field>
        </FormGrid>
        <Field label="Note" name="note">
          <Input id="note" name="note" placeholder="Optional" maxLength={500} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save payment</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function RefundDialog({ id, maxAmount, today }: { id: string; maxAmount: number; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title="Record refund"
      description={`Money returned to the client. At most ${inr(maxAmount, true)} (net amount paid).`}
      trigger={<Button variant="secondary" size="sm">Refund</Button>}
    >
      <ActionForm action={(input) => recordRefund(id, input)} successMessage="Refund recorded" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Amount (₹)" name="amount" required>
            <Input id="amount" name="amount" type="number" inputMode="decimal" min={0.01} max={maxAmount} step="0.01" defaultValue={maxAmount} />
          </Field>
          <Field label="Date" name="date" required>
            <Input id="date" name="date" type="date" max={today} defaultValue={today} />
          </Field>
          <Field label="Method" name="method" required>
            <Select id="method" name="method" defaultValue={INVOICE_PAYMENT_METHODS[0]}>
              {INVOICE_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" name="reference">
            <Input id="reference" name="reference" maxLength={120} />
          </Field>
        </FormGrid>
        <Field label="Reason" name="note" required>
          <Textarea id="note" name="note" rows={2} maxLength={500} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton variant="danger">Record refund</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function AdjustmentDialog({ id, balance, today }: { id: string; balance: number; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title="Adjustment / write-off"
      description={`Reduces the balance without a payment (for example a short payment written off). At most ${inr(balance, true)}.`}
      trigger={<Button variant="secondary" size="sm">Adjust / write off</Button>}
    >
      <ActionForm action={(input) => recordAdjustment(id, input)} successMessage="Adjustment recorded" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Amount (₹)" name="amount" required>
            <Input id="amount" name="amount" type="number" inputMode="decimal" min={0.01} max={balance} step="0.01" />
          </Field>
          <Field label="Date" name="date" required>
            <Input id="date" name="date" type="date" max={today} defaultValue={today} />
          </Field>
        </FormGrid>
        <Field label="Note" name="note" required hint="Explain why the balance is being reduced.">
          <Textarea id="note" name="note" rows={3} maxLength={500} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Record adjustment</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
