"use client";

import { useState } from "react";
import { Check, CheckCheck, FlaskConical, Play, RotateCcw, Wrench } from "lucide-react";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, SubmitButton } from "@/components/ui/form";
import { Textarea } from "@/components/ui/input";
import { closeIssue, markIssueFixed, markReadyForTesting, reopenIssue, startIssue, verifyIssue } from "../actions";

export type IssueStepKey = "start" | "fix" | "ready" | "verify" | "close" | "reopen";

function FixDialog({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      title="Mark as fixed"
      description="Describe what you changed so QA knows what to test."
      trigger={
        <Button icon={<Wrench className="size-4" aria-hidden />} className="w-full">
          Mark fixed
        </Button>
      }
    >
      <ActionForm action={(input) => markIssueFixed(issueId, input)} successMessage="Marked as fixed" onSuccess={() => setOpen(false)}>
        <Field label="Resolution" name="resolution" required hint="Root cause, the fix and where it was deployed">
          <Textarea id="resolution" name="resolution" rows={5} />
        </Field>
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Mark fixed</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}

/** The workflow buttons the viewer may use on this issue right now (the server re-checks every step). */
export function IssueActions({ issueId, steps }: { issueId: string; steps: IssueStepKey[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {steps.includes("start") && (
        <ActionButton action={() => startIssue(issueId)} icon={<Play className="size-4" aria-hidden />} className="w-full" successMessage="Work started">
          Start work
        </ActionButton>
      )}
      {steps.includes("fix") && <FixDialog issueId={issueId} />}
      {steps.includes("ready") && (
        <ActionButton action={() => markReadyForTesting(issueId)} icon={<FlaskConical className="size-4" aria-hidden />} className="w-full" successMessage="Ready for testing">
          Ready for testing
        </ActionButton>
      )}
      {steps.includes("verify") && (
        <ActionButton action={() => verifyIssue(issueId)} variant="success" icon={<Check className="size-4" aria-hidden />} className="w-full" confirm="Confirm the fix works as expected?" successMessage="Fix verified">
          Verify fix
        </ActionButton>
      )}
      {steps.includes("close") && (
        <ActionButton action={() => closeIssue(issueId)} variant="secondary" icon={<CheckCheck className="size-4" aria-hidden />} className="w-full" confirm="Close this issue?" successMessage="Issue closed">
          Close issue
        </ActionButton>
      )}
      {steps.includes("reopen") && (
        <ReasonAction
          action={(reason) => reopenIssue(issueId, reason)}
          title="Reopen issue"
          description="The issue goes back to the assignee. Say what is still wrong."
          label="What is still wrong?"
          confirmLabel="Reopen"
          confirmVariant="danger"
          successMessage="Issue reopened"
          trigger={
            <Button variant="danger-outline" icon={<RotateCcw className="size-4" aria-hidden />} className="w-full">
              Reopen
            </Button>
          }
        />
      )}
    </div>
  );
}
