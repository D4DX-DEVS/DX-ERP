"use client";

import { Check } from "lucide-react";
import { ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { completeResource } from "../actions";

export function CompleteButton({ resourceId, title }: { resourceId: string; title: string }) {
  return (
    <ReasonAction
      title="Mark as complete"
      description={title}
      label="Note"
      required={false}
      placeholder="Optional — what did you learn or deliver?"
      confirmLabel="Mark complete"
      successMessage="Marked as complete"
      action={(note) => completeResource(resourceId, note)}
      trigger={
        <Button size="sm" icon={<Check className="size-3.5" />}>
          Mark complete
        </Button>
      }
    />
  );
}
