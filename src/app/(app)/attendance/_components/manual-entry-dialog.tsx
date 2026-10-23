"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { PeoplePicker, type PickerOption } from "@/components/ui/people-picker";
import { saveManualAttendance } from "../actions";

/** Manual attendance entry / edit for one person and day (attendance.manage). A reason is mandatory. */
export function ManualEntryDialog({
  trigger,
  people,
  today,
  defaults,
}: {
  trigger: ReactNode;
  people: PickerOption[];
  today: string;
  defaults?: { userId?: string; date?: string; checkIn?: string; checkOut?: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      title="Manual attendance entry"
      description="Creates or replaces the check-in and check-out for the day. The change is recorded in the day's history and the audit trail."
    >
      <ActionForm action={saveManualAttendance} successMessage="Attendance saved" onSuccess={() => setOpen(false)}>
        <Field label="Person" name="userId" required>
          <PeoplePicker name="userId" options={people} defaultValue={defaults?.userId} placeholder="Select person" allowClear={false} />
        </Field>
        <FormGrid cols={3}>
          <Field label="Date" name="date" required>
            <Input id="date" name="date" type="date" max={today} defaultValue={defaults?.date ?? today} required />
          </Field>
          <Field label="Check-in" name="checkIn" required>
            <Input id="checkIn" name="checkIn" type="time" defaultValue={defaults?.checkIn ?? ""} required />
          </Field>
          <Field label="Check-out" name="checkOut" hint="Blank = still open">
            <Input id="checkOut" name="checkOut" type="time" defaultValue={defaults?.checkOut ?? ""} />
          </Field>
        </FormGrid>
        <Field label="Reason" name="reason" required>
          <Textarea id="reason" name="reason" rows={3} placeholder="Why is this being entered manually?" />
        </Field>
        <FormActions>
          <SubmitButton>Save entry</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
