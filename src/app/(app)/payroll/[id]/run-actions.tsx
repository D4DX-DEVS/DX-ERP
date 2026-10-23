"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { inr } from "@/lib/format";
import { PAYROLL_PAYMENT_METHODS } from "@/lib/payroll/constants";
import { approveRun, cancelRun, payPayslip, payRun, recalculateRun, returnRunToDraft, savePayslipLines, verifyRun } from "../actions";

export function RunWorkflowButtons({
  id,
  status,
  canPrepare,
  canApprove,
  canPay,
  awaitingPayment,
  netToPay,
  today,
}: {
  id: string;
  status: string;
  canPrepare: boolean;
  canApprove: boolean;
  canPay: boolean;
  awaitingPayment: number;
  netToPay: number;
  today: string;
}) {
  return (
    <>
      {status === "draft" && canPrepare && (
        <>
          <ReasonAction
            title="Cancel run"
            description="The run and its payslips are discarded. You can create a new run for the same month afterwards."
            label="Reason for cancelling"
            confirmLabel="Cancel run"
            confirmVariant="danger"
            action={(reason) => cancelRun(id, reason)}
            successMessage="Run cancelled"
            trigger={<Button variant="danger-outline">Cancel run</Button>}
          />
          <ActionButton variant="secondary" action={() => recalculateRun(id)} successMessage="Run recalculated">
            Recalculate
          </ActionButton>
          <ActionButton
            action={() => verifyRun(id)}
            confirm="Confirm that attendance, leave and employment details for this period have been verified. The run is then locked for editing and sent to management for approval."
            successMessage="Run verified and sent for approval"
          >
            Mark verified
          </ActionButton>
        </>
      )}
      {status === "verified" && (canPrepare || canApprove) && (
        <>
          <ReasonAction
            title="Cancel run"
            description="The run is discarded. You can create a new run for the same month afterwards."
            label="Reason for cancelling"
            confirmLabel="Cancel run"
            confirmVariant="danger"
            action={(reason) => cancelRun(id, reason)}
            successMessage="Run cancelled"
            trigger={<Button variant="danger-outline">Cancel run</Button>}
          />
          <ReasonAction
            title="Send back for changes"
            description="The run returns to draft so it can be corrected and verified again."
            label="What needs to change?"
            confirmLabel="Send back"
            action={(reason) => returnRunToDraft(id, reason)}
            successMessage="Run sent back to draft"
            trigger={<Button variant="secondary">Send back</Button>}
          />
        </>
      )}
      {status === "verified" && canApprove && (
        <ActionButton variant="success" action={() => approveRun(id)} confirm="Approve this run? Approved runs are locked and Finance can then record payment." successMessage="Run approved">
          Approve payroll
        </ActionButton>
      )}
      {status === "approved" && canPay && awaitingPayment > 0 && <PayRunDialog id={id} count={awaitingPayment} net={netToPay} today={today} />}
    </>
  );
}

function PaymentFields({ today }: { today: string }) {
  return (
    <>
      <FormGrid>
        <Field label="Payment date" name="date" required>
          <Input id="date" name="date" type="date" max={today} defaultValue={today} />
        </Field>
        <Field label="Method" name="method" required>
          <Select id="method" name="method" defaultValue={PAYROLL_PAYMENT_METHODS[0]}>
            {PAYROLL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>
      <Field label="Reference" name="reference" hint="Batch UTR, cheque number or voucher.">
        <Input id="reference" name="reference" maxLength={120} />
      </Field>
    </>
  );
}

export function PayRunDialog({ id, count, net, today }: { id: string; count: number; net: number; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title="Record payment for the run"
      description={`${count} ${count === 1 ? "payslip" : "payslips"} · net ${inr(net, true)}. Each person is told their payslip is ready; advance recoveries and reimbursements are applied.`}
      trigger={<Button>Record payment</Button>}
    >
      <ActionForm action={(input) => payRun(id, input)} successMessage="Payments recorded" onSuccess={() => setOpen(false)}>
        <PaymentFields today={today} />
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Mark all as paid</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function PayslipPayDialog({ id, name, net, today }: { id: string; name: string; net: number; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title={`Pay ${name}`}
      description={`Net pay ${inr(net, true)}.`}
      trigger={
        <Button size="sm" variant="secondary">
          Pay
        </Button>
      }
    >
      <ActionForm action={(input) => payPayslip(id, input)} successMessage="Payment recorded" onSuccess={() => setOpen(false)}>
        <PaymentFields today={today} />
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Mark as paid</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

interface ManualLine {
  name: string;
  amount: string;
}

const SUGGESTIONS = ["Bonus", "Incentive", "Overtime", "TDS", "Other"];

function LineList({ title, hint, lines, onChange, addLabel, idPrefix }: { title: string; hint: string; lines: ManualLine[]; onChange: (lines: ManualLine[]) => void; addLabel: string; idPrefix: string }) {
  const update = (i: number, patch: Partial<ManualLine>) => onChange(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <fieldset className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <legend className="text-[13px] font-semibold text-ink-2">{title}</legend>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={() => onChange([...lines, { name: "", amount: "" }])}>
          {addLabel}
        </Button>
      </div>
      {lines.length === 0 && <p className="rounded-lg bg-field px-3 py-2 text-[13px] text-muted">None.</p>}
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_36px] items-center gap-2">
          <Input aria-label={`${title} ${i + 1} name`} list={`${idPrefix}-suggestions`} placeholder="Name" value={l.name} maxLength={80} onChange={(e) => update(i, { name: e.target.value })} />
          <Input aria-label={`${title} ${i + 1} amount`} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })} />
          <button type="button" aria-label={`Remove ${title.toLowerCase()} line ${i + 1}`} onClick={() => onChange(lines.filter((_, idx) => idx !== i))} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-danger-bg hover:text-danger">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <datalist id={`${idPrefix}-suggestions`}>
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </fieldset>
  );
}

/** Edit the manual earning / deduction lines and remarks of a draft payslip. */
export function PayslipEditDialog({ id, name, earnings, deductions, remarks }: { id: string; name: string; earnings: ManualLine[]; deductions: ManualLine[]; remarks: string }) {
  const [open, setOpen] = useState(false);
  const [earn, setEarn] = useState<ManualLine[]>(earnings);
  const [ded, setDed] = useState<ManualLine[]>(deductions);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setEarn(earnings);
          setDed(deductions);
        }
        setOpen(o);
      }}
      size="md"
      title={`Adjust payslip · ${name}`}
      description="Bonus, incentive, overtime, TDS and other one-off lines. They are kept when the run is recalculated. Saving also refreshes this person's attendance-based figures."
      trigger={
        <Button size="sm" variant="ghost">
          Adjust
        </Button>
      }
    >
      <ActionForm
        action={(input) => savePayslipLines(id, input)}
        values={{
          earnings: earn.filter((l) => l.name.trim() || l.amount).map((l) => ({ name: l.name, amount: l.amount })),
          deductions: ded.filter((l) => l.name.trim() || l.amount).map((l) => ({ name: l.name, amount: l.amount })),
        }}
        successMessage="Payslip updated"
        onSuccess={() => setOpen(false)}
      >
        <LineList title="Extra earnings" hint="Added to gross pay." lines={earn} onChange={setEarn} addLabel="Add earning" idPrefix={`earn-${id}`} />
        <LineList title="Extra deductions" hint="Subtracted from net pay (for example TDS)." lines={ded} onChange={setDed} addLabel="Add deduction" idPrefix={`ded-${id}`} />
        <Field label="Remarks" name="remarks" hint="Shown on the payslip register only.">
          <Textarea id="remarks" name="remarks" rows={2} maxLength={500} defaultValue={remarks} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save changes</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
