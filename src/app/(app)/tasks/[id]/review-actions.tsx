"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { Select, Textarea } from "@/components/ui/input";
import { approveSubmission, requestTaskChanges } from "../actions";

/** Reviewer controls: approve (optional 1–5 rating) or request changes. */
export function ReviewActions({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title="Approve work"
        description="The task is marked done and the assignees are notified."
        trigger={
          <Button variant="success" icon={<Check className="size-4" aria-hidden />}>
            Approve
          </Button>
        }
      >
        <ActionForm action={(input) => approveSubmission(taskId, input)} successMessage="Work approved" onSuccess={() => setOpen(false)}>
          <Field label="Rating" name="rating" hint="Optional — useful for intern and trainee evaluations">
            <Select id="rating" name="rating" defaultValue="">
              <option value="">No rating</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Feedback" name="note">
            <Textarea id="note" name="note" rows={3} placeholder="Optional feedback for the assignee" />
          </Field>
          <FormActions>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant="success">Approve</SubmitButton>
          </FormActions>
        </ActionForm>
      </Dialog>
      <ReasonAction
        action={(reason) => requestTaskChanges(taskId, reason)}
        title="Request changes"
        description="Explain what needs to change. The task goes back to the assignees."
        label="What needs to change?"
        confirmLabel="Request changes"
        successMessage="Changes requested"
        trigger={<Button variant="danger-outline">Request changes</Button>}
      />
    </div>
  );
}
