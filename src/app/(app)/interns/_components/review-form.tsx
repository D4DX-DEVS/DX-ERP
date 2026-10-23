"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, Field, FormActions, FormGrid, SubmitButton } from "@/components/ui/form";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { saveReview } from "../actions";
import { averageRating, COMPETENCIES } from "../_lib/competencies";

export interface ReviewFormValues {
  id: string;
  periodLabel: string;
  date: string;
  scores: Record<string, number>;
  overall: number;
  strengths: string;
  improvements: string;
  actionItems: string[];
}

function RatingInput({ name, value, onChange, label }: { name: string; value: number | null; onChange: (n: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={cn("flex size-10 cursor-pointer items-center justify-center rounded-[9px] text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500", value === n ? "bg-brand-600 text-white" : "border border-line-strong text-ink-2 hover:bg-field")}>
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" />
          {n}
        </label>
      ))}
    </div>
  );
}

/** Create / edit-draft dialog for an intern evaluation. */
export function ReviewFormButton({
  userId,
  firstName,
  today,
  initial,
  label = "New evaluation",
  variant = "primary",
  size = "md",
}: {
  userId: string;
  firstName: string;
  today: string;
  initial?: ReviewFormValues;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>(initial?.scores ?? {});
  const [overall, setOverall] = useState<number | null>(initial?.overall ?? null);
  const rated = COMPETENCIES.filter((c) => scores[c.key]).length;
  const average = rated === COMPETENCIES.length ? averageRating(COMPETENCIES.map((c) => scores[c.key])) : null;
  const shownOverall = overall ?? (average !== null ? Math.round(average) : null);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title={initial ? "Edit draft evaluation" : "New evaluation"}
      description="Ratings run from 1 (needs significant improvement) to 5 (outstanding)."
      trigger={
        <Button variant={variant} size={size} icon={initial ? undefined : <Plus className="size-4" />}>
          {label}
        </Button>
      }
    >
      <ActionForm action={saveReview} values={{ userId, ...(initial ? { reviewId: initial.id } : {}) }} successMessage="Evaluation saved" onSuccess={() => setOpen(false)}>
        <FormGrid>
          <Field label="Evaluation period" name="periodLabel" required>
            <Input id="periodLabel" name="periodLabel" maxLength={100} placeholder="e.g. Mid-term · Oct 2026" defaultValue={initial?.periodLabel ?? ""} />
          </Field>
          <Field label="Date" name="date" required>
            <Input id="date" name="date" type="date" defaultValue={initial?.date ?? today} />
          </Field>
        </FormGrid>

        <div className="overflow-hidden rounded-xl border border-line">
          {COMPETENCIES.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-soft px-4 py-3 first:border-t-0">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{c.label}</div>
                <div className="text-xs text-muted">{c.hint}</div>
              </div>
              <Field name={`rating_${c.key}`}>
                <RatingInput name={`rating_${c.key}`} label={c.label} value={scores[c.key] ?? null} onChange={(n) => setScores((s) => ({ ...s, [c.key]: n }))} />
              </Field>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-field px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-ink">Overall</div>
              <div className="text-xs text-muted">{average !== null ? `Average of ratings: ${average}` : "Defaults to the average once every competency is rated"}</div>
            </div>
            <RatingInput name="overall" label="Overall rating" value={shownOverall} onChange={setOverall} />
          </div>
        </div>

        <Field label="Strengths" name="strengths">
          <Textarea id="strengths" name="strengths" rows={3} maxLength={3000} defaultValue={initial?.strengths ?? ""} />
        </Field>
        <Field label="Areas to improve" name="improvements">
          <Textarea id="improvements" name="improvements" rows={3} maxLength={3000} defaultValue={initial?.improvements ?? ""} />
        </Field>
        <Field label="Action items" name="actionItems" hint="One per line — tracked until done">
          <Textarea id="actionItems" name="actionItems" rows={3} defaultValue={(initial?.actionItems ?? []).join("\n")} />
        </Field>
        <Checkbox name="share" label={`Share with ${firstName} now (they are notified and can acknowledge)`} />
        <FormActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <SubmitButton>Save evaluation</SubmitButton>
        </FormActions>
      </ActionForm>
    </Dialog>
  );
}
