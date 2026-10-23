"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select } from "@/components/ui/input";
import { inr } from "@/lib/format";
import { approveExpense, deleteExpense, payExpense, rejectExpense, submitExpense } from "./actions";
import { EXPENSE_PAY_METHODS } from "./constants";

export function ApproveExpenseButton({ id, size = "md" }: { id: string; size?: ButtonProps["size"] }) {
  return (
    <ActionButton variant="success" size={size} action={() => approveExpense(id)} successMessage="Expense approved">
      Approve
    </ActionButton>
  );
}

export function RejectExpenseButton({ id, size = "md" }: { id: string; size?: ButtonProps["size"] }) {
  return (
    <ReasonAction
      title="Reject expense"
      description="The person is notified with your reason and can correct and resubmit."
      label="Reason for rejecting"
      confirmLabel="Reject expense"
      confirmVariant="danger"
      action={(reason) => rejectExpense(id, reason)}
      successMessage="Expense rejected"
      trigger={
        <Button variant="danger-outline" size={size}>
          Reject
        </Button>
      }
    />
  );
}

export function SubmitExpenseButton({ id, label = "Submit for approval" }: { id: string; label?: string }) {
  return (
    <ActionButton action={() => submitExpense(id)} successMessage="Submitted for approval">
      {label}
    </ActionButton>
  );
}

export function DeleteExpenseButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ActionButton variant="danger-outline" action={() => deleteExpense(id)} confirm="Delete this expense permanently?" successMessage="Expense deleted" onSuccess={() => router.push("/expenses")}>
      Delete
    </ActionButton>
  );
}

export function PayExpenseDialog({ id, amount, today, reimbursable, size = "md" }: { id: string; amount: number; today: string; reimbursable: boolean; size?: ButtonProps["size"] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title={reimbursable ? "Record reimbursement" : "Record payment"}
      description={`${inr(amount, true)}. The person is notified when this is saved.`}
      trigger={
        <Button size={size} variant="primary">
          {reimbursable ? "Reimburse" : "Mark paid"}
        </Button>
      }
    >
      <ActionForm action={(input) => payExpense(id, input)} successMessage="Payment recorded" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Date" name="date" required>
            <Input id="date" name="date" type="date" max={today} defaultValue={today} />
          </Field>
          <Field label="Method" name="method" required>
            <Select id="method" name="method" defaultValue={EXPENSE_PAY_METHODS[0]}>
              {EXPENSE_PAY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
        <Field label="Reference" name="reference" hint="UTR, cheque number or voucher.">
          <Input id="reference" name="reference" maxLength={120} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
