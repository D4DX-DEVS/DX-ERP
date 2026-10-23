"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { updateTaskProgress } from "../actions";

/** Progress slider that assignees use to report how far along the task is. */
export function ProgressSlider({ taskId, initial, disabled }: { taskId: string; initial: number; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  const { pending, run } = useServerAction();
  const dirty = value !== initial;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor="task-progress" className="text-muted">
          Progress
        </label>
        <span className="font-semibold text-ink tabular">{value}%</span>
      </div>
      <input
        id="task-progress"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled || pending}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full accent-brand-600"
      />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setValue(initial)} disabled={pending}>
            Reset
          </Button>
          <Button size="sm" loading={pending} onClick={() => run(() => updateTaskProgress(taskId, value), { successMessage: "Progress saved" })}>
            Save progress
          </Button>
        </div>
      )}
    </div>
  );
}
