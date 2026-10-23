"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm, Field, useServerAction } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { addObjective, updateObjective } from "../actions";

export interface ObjectiveView {
  id: string;
  text: string;
  status: "open" | "in_progress" | "achieved" | "dropped";
}

const STATUS_LABELS: Record<ObjectiveView["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  achieved: "Achieved",
  dropped: "Dropped",
};

/** Objectives list with status updates (mentor / interns.manage) and an add form. */
export function ObjectivesPanel({ userId, objectives, canEdit }: { userId: string; objectives: ObjectiveView[]; canEdit: boolean }) {
  const { pending, run } = useServerAction();
  return (
    <div className="flex flex-col gap-3">
      {objectives.length === 0 && <p className="text-[13px] text-muted">No objectives set yet.</p>}
      <ul className="flex flex-col">
        {objectives.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0">
            <span
              className={cn(
                "flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
                o.status === "achieved" ? "bg-tone-purple text-white" : "border-[1.5px] border-[#c4cad9] text-transparent",
                o.status === "dropped" && "bg-track",
              )}
              aria-hidden
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
            <span className={cn("min-w-0 flex-1 basis-48 text-[13px] leading-snug", o.status === "achieved" || o.status === "dropped" ? "text-muted" : "font-medium text-ink", o.status === "dropped" && "line-through")}>{o.text}</span>
            {canEdit ? (
              <select
                aria-label={`Status of objective: ${o.text}`}
                value={o.status}
                disabled={pending}
                onChange={(e) => run(() => updateObjective(userId, o.id, e.target.value), { successMessage: "Objective updated" })}
                className="h-8 rounded-lg border border-line-strong bg-white px-2 text-xs font-medium text-ink-2 focus:border-brand-500 focus:outline-none"
              >
                {(Object.keys(STATUS_LABELS) as ObjectiveView["status"][]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-semibold text-ink-2">{STATUS_LABELS[o.status]}</span>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <ActionForm action={addObjective} values={{ userId }} resetOnSuccess successMessage="Objective added" className="flex-row flex-wrap items-end gap-2">
          <Field label="Add objective" name="text" className="min-w-0 flex-1 basis-56">
            <Input id="text" name="text" maxLength={300} placeholder="e.g. Ship one feature end-to-end" />
          </Field>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </ActionForm>
      )}
    </div>
  );
}
