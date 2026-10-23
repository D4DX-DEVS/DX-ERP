"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { Textarea } from "@/components/ui/input";
import { updateTaskBlocker } from "../actions";

/** Free-text note explaining what is blocking the task. */
export function BlockerNote({ taskId, initial }: { taskId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const { pending, run } = useServerAction();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="task-blocker" className="text-xs text-muted">
        Blocker note
      </label>
      <Textarea id="task-blocker" rows={2} value={value} maxLength={1000} placeholder="What is blocking this task?" onChange={(e) => setValue(e.target.value)} />
      {value.trim() !== initial.trim() && (
        <div className="flex justify-end">
          <Button size="sm" loading={pending} onClick={() => run(() => updateTaskBlocker(taskId, value), { successMessage: "Blocker note saved" })}>
            Save note
          </Button>
        </div>
      )}
    </div>
  );
}
