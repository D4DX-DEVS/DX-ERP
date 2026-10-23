"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Select, Switch } from "@/components/ui/input";
import { reviseSalary, reviseStipend } from "../[id]/actions";
import { STIPEND_PERIODS } from "../_lib/constants";
import { MoneyLines } from "./money-lines";

export function ReviseSalaryButton({
  userId,
  salary,
  today,
}: {
  userId: string;
  salary?: { basic: number; allowances: { name: string; amount: number }[]; deductions: { name: string; amount: number }[] };
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title="Revise salary"
      description="The new structure becomes current from the effective date and is added to the revision history."
      trigger={
        <Button size="sm" icon={<Pencil className="size-3.5" />}>
          Revise salary
        </Button>
      }
    >
      <ActionForm action={reviseSalary} values={{ userId }} successMessage="Salary revised" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Basic (₹ / month)" name="basic" required>
            <Input id="basic" name="basic" inputMode="decimal" defaultValue={salary ? String(salary.basic) : ""} />
          </Field>
          <Field label="Effective from" name="effectiveFrom" required>
            <Input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} />
          </Field>
        </FormGrid>
        <MoneyLines label="Allowances" prefix="allowance" initial={salary?.allowances} suggestions={["House rent allowance", "Conveyance allowance", "Special allowance"]} />
        <MoneyLines label="Deductions" prefix="deduction" initial={salary?.deductions} suggestions={["Provident fund", "Professional tax"]} />
        <Field label="Reason / note" name="note">
          <Input id="note" name="note" maxLength={500} placeholder="e.g. Annual appraisal" />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save revision</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function ReviseStipendButton({
  userId,
  stipend,
  today,
}: {
  userId: string;
  stipend: { eligible: boolean; amount: number; period: "monthly" | "one_time" };
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState(stipend.eligible);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Revise stipend"
      trigger={
        <Button size="sm" icon={<Pencil className="size-3.5" />}>
          Revise stipend
        </Button>
      }
    >
      <ActionForm action={reviseStipend} values={{ userId }} successMessage="Stipend revised" onSuccess={() => setOpen(false)}>
        <Switch name="eligible" label="Stipend eligible" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />
        <FormGrid>
          <Field label="Amount (₹)" name="amount" required>
            <Input id="amount" name="amount" inputMode="decimal" defaultValue={String(stipend.amount)} />
          </Field>
          <Field label="Period" name="period">
            <Select id="period" name="period" defaultValue={stipend.period}>
              {STIPEND_PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Effective from" name="effectiveFrom" required>
            <Input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} />
          </Field>
          <Field label="Note" name="note">
            <Input id="note" name="note" maxLength={500} />
          </Field>
        </FormGrid>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save revision</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
