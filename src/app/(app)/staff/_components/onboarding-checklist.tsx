"use client";

import { Check } from "lucide-react";
import { Progress } from "@/components/ui/page";
import { useServerAction } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { toggleOnboardingStep } from "../[id]/actions";

export interface ChecklistStep {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  doneOn?: string;
  /** Marked by the system (first sign-in) and not editable by hand. */
  auto: boolean;
}

export function OnboardingChecklist({ userId, steps, canEdit }: { userId: string; steps: ChecklistStep[]; canEdit: boolean }) {
  const { pending, run } = useServerAction();
  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Progress value={pct} tone={pct === 100 ? "green" : "brand"} className="flex-1" />
        <span className="text-[13px] font-semibold text-ink tabular">
          {doneCount} / {steps.length}
        </span>
      </div>
      <ul className="flex flex-col">
        {steps.map((s) => {
          const editable = canEdit && !s.auto;
          const box = (
            <span
              className={cn(
                "flex size-[22px] shrink-0 items-center justify-center rounded-md border-[1.5px]",
                s.done ? "border-success bg-success text-white" : "border-[#c4cad9] bg-white text-transparent",
              )}
              aria-hidden
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
          );
          const text = (
            <span className="flex min-w-0 flex-col text-left">
              <span className={cn("text-sm font-medium", s.done ? "text-ink-2" : "text-ink")}>{s.label}</span>
              <span className="text-xs text-muted">{s.done && s.doneOn ? `Done ${s.doneOn}` : s.hint}</span>
            </span>
          );
          return (
            <li key={s.key} className="border-t border-line-soft first:border-t-0">
              {editable ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={s.done}
                  disabled={pending}
                  onClick={() => run(() => toggleOnboardingStep(userId, s.key, !s.done), { successMessage: false })}
                  className="flex w-full items-center gap-3 py-2.5 hover:bg-field/60 disabled:opacity-60"
                >
                  {box}
                  {text}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-2.5">
                  {box}
                  {text}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
