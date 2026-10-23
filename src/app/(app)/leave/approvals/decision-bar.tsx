"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { approveLeave, rejectLeave } from "../actions";

/** Comment box with Reject / Approve (a comment is required to reject). */
export function DecisionBar({ id, name }: { id: string; name: string }) {
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);
  const { pending, run } = useServerAction();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Comment for ${name}'s request`}
          aria-invalid={missing}
          placeholder="Comment (required to reject)"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setMissing(false);
          }}
          maxLength={500}
          className="h-10 min-w-0 flex-[1_1_180px] sm:h-10"
        />
        <Button
          variant="danger-outline"
          disabled={pending}
          onClick={() => {
            if (!note.trim()) {
              setMissing(true);
              return;
            }
            run(() => rejectLeave(id, note), { successMessage: "Leave rejected" });
          }}
        >
          Reject
        </Button>
        <Button variant="success" loading={pending} onClick={() => run(() => approveLeave(id, note), { successMessage: "Leave approved" })}>
          Approve
        </Button>
      </div>
      {missing && <p className="text-xs font-medium text-danger">Add a comment to reject this request.</p>}
    </div>
  );
}
