"use client";

import { Button } from "@/components/ui/button";
import { ReasonAction } from "@/components/ui/actions";
import { completeFollowUp } from "../actions";

/** "Mark done" with an optional outcome note. */
export function CompleteFollowUp({ id }: { id: string }) {
  return (
    <ReasonAction
      action={(outcome) => completeFollowUp(id, outcome)}
      title="Mark follow-up done"
      description="Record what happened so the history stays useful."
      label="Outcome"
      required={false}
      placeholder="What happened? (optional)"
      confirmLabel="Mark done"
      successMessage="Follow-up marked done"
      trigger={
        <Button size="sm" variant="secondary">
          Mark done
        </Button>
      }
    />
  );
}
