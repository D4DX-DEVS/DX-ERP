"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FileUpload } from "@/components/ui/file-upload";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { submitWork } from "../actions";

/** Assignee hand-in: note, optional link and files; moves the task to review. */
export function SubmitWork({ taskId, pendingReview }: { taskId: string; pendingReview: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Submit work for review"
      description="Your reviewer is notified and the task moves to review."
      trigger={
        <Button size="lg" icon={<Send className="size-4" aria-hidden />} disabled={pendingReview} className="w-full">
          {pendingReview ? "Awaiting review" : "Submit work for review"}
        </Button>
      }
    >
      <ActionForm action={(input) => submitWork(taskId, input)} successMessage="Submitted for review" onSuccess={() => setOpen(false)}>
        <Field label="What did you complete?" name="note" required>
          <Textarea id="note" name="note" rows={4} placeholder="Summary of the work, how to check it, anything the reviewer should know" />
        </Field>
        <Field label="Link" name="link" hint="Pull request, staging URL, shared document… (optional)">
          <Input id="link" name="link" type="url" inputMode="url" placeholder="https://" />
        </Field>
        <FileUpload context={{ entityType: "submission", entityId: taskId }} label="Attach deliverables" />
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Submit</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
