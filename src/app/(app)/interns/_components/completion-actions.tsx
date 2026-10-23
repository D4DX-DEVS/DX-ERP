"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { approveCertificate, completeInternship, extendInternship, issueCertificate, requestCertificate } from "../actions";

export function CompleteInternshipButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} size="sm" title="Mark internship completed" description={`Closes ${name}'s internship. The intern and internship managers are notified.`} trigger={<Button>Mark completed</Button>}>
      <ActionForm action={completeInternship} values={{ userId }} successMessage="Internship marked completed" onSuccess={() => setOpen(false)}>
        <Field label="Completion note" name="note" required hint="Summary of the internship — recorded in the history">
          <Textarea id="note" name="note" rows={4} maxLength={2000} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Mark completed</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function ExtendInternshipButton({ userId, currentEnd }: { userId: string; currentEnd?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} size="sm" title="Extend internship" description="Sets a later end date and marks the internship as extended." trigger={<Button variant="secondary">Extend end date</Button>}>
      <ActionForm action={extendInternship} values={{ userId }} successMessage="Internship extended" onSuccess={() => setOpen(false)}>
        <Field label="New end date" name="endDate" required hint={currentEnd ? `Current end date: ${currentEnd}` : undefined}>
          <Input id="endDate" name="endDate" type="date" min={currentEnd} />
        </Field>
        <Field label="Reason" name="reason">
          <Input id="reason" name="reason" maxLength={1000} placeholder="Optional" />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Extend</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

export function RequestCertificateButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={() => requestCertificate(userId)} confirm="Send a certificate request to the internship managers?" successMessage="Certificate requested">
      Request certificate
    </ActionButton>
  );
}

export function ApproveCertificateButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={() => approveCertificate(userId)} confirm="Approve the certificate for this intern?" successMessage="Certificate approved">
      Approve certificate
    </ActionButton>
  );
}

export function IssueCertificateButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={() => issueCertificate(userId)} confirm="Issue the certificate? A certificate number is generated and the intern is notified." successMessage="Certificate issued">
      Issue certificate
    </ActionButton>
  );
}
