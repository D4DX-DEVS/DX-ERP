"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { requestCorrection } from "../actions";

/** "Request correction" dialog: date, corrected check-in / check-out times and a reason. */
export function CorrectionDialog({ trigger, today, defaultDate, hint }: { trigger: ReactNode; today: string; defaultDate?: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      title="Request attendance correction"
      description="Your manager or HR reviews it. The recorded times stay as they are until it is approved."
    >
      <ActionForm action={requestCorrection} successMessage="Correction request submitted" onSuccess={() => setOpen(false)}>
        {hint && <p className="rounded-[10px] bg-field px-3 py-2 text-[13px] text-ink-2">{hint}</p>}
        <Field label="Date" name="date" required>
          <Input id="date" name="date" type="date" max={today} defaultValue={defaultDate ?? ""} required />
        </Field>
        <FormGrid cols={2}>
          <Field label="Check-in" name="checkIn" hint="Leave blank to keep the recorded time">
            <Input id="checkIn" name="checkIn" type="time" />
          </Field>
          <Field label="Check-out" name="checkOut" hint="Leave blank to keep the recorded time">
            <Input id="checkOut" name="checkOut" type="time" />
          </Field>
        </FormGrid>
        <Field label="Reason" name="reason" required>
          <Textarea id="reason" name="reason" rows={3} placeholder="What happened? e.g. forgot to check out, app was down" />
        </Field>
        <FormActions>
          <SubmitButton>Submit request</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
