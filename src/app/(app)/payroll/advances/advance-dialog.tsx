"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { createAdvance } from "../actions";

export function AdvanceDialog({ people, today }: { people: PickerOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      title="Record salary advance"
      description="The advance is recovered from payslips at the monthly amount until it is cleared. Recovery never pushes net pay below zero."
      trigger={<Button icon={<Plus className="size-4" aria-hidden />}>Record advance</Button>}
    >
      <ActionForm action={createAdvance} successMessage="Advance recorded" onSuccess={() => setOpen(false)}>
        <Field label="Person" name="user" required>
          <PeoplePicker name="user" options={people} placeholder="Select person" />
        </Field>
        <FormGrid>
          <Field label="Amount (₹)" name="amount" required>
            <Input id="amount" name="amount" type="number" inputMode="decimal" min={1} step="0.01" />
          </Field>
          <Field label="Monthly recovery (₹)" name="monthlyRecovery" required>
            <Input id="monthlyRecovery" name="monthlyRecovery" type="number" inputMode="decimal" min={1} step="0.01" />
          </Field>
          <Field label="Date given" name="date" required>
            <Input id="date" name="date" type="date" max={today} defaultValue={today} />
          </Field>
        </FormGrid>
        <Field label="Reason" name="reason">
          <Textarea id="reason" name="reason" rows={2} maxLength={500} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Record advance</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
