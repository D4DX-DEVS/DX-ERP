"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { claimCompOff } from "../comp-off-actions";

/** "Claim comp-off" dialog: a weekend or holiday the person worked, within the claim window. */
export function CompOffClaimDialog({ min, max, windowDays, fullDay, halfDay }: { min: string; max: string; windowDays: number; fullDay: string; halfDay: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Claim comp-off"
      description={`For a weekend or company holiday you worked in the last ${windowDays} days. ${fullDay}+ worked earns a full day, ${halfDay}+ a half day.`}
      trigger={
        <Button variant="secondary" size="sm" icon={<CalendarPlus className="size-4" />}>
          Claim comp-off
        </Button>
      }
    >
      <ActionForm action={claimCompOff} successMessage="Comp-off claim submitted" onSuccess={() => setOpen(false)}>
        <Field label="Date worked" name="workDate" required hint="Your attendance for that day must show check-in and check-out.">
          <Input id="workDate" name="workDate" type="date" min={min} max={max} defaultValue="" />
        </Field>
        <Field label="What you worked on" name="reason" required>
          <Textarea id="reason" name="reason" rows={3} placeholder="e.g. Production release for PRJ-0012" />
        </Field>
        <FormActions>
          <SubmitButton>Submit claim</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
