"use client";

import { Check } from "lucide-react";
import { ActionButton, ReasonAction } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { acknowledgeReview, deleteReview, shareReview, toggleActionItem } from "../actions";
import { ReviewFormButton, type ReviewFormValues } from "./review-form";

export interface ActionItemView {
  id: string;
  text: string;
  done: boolean;
}

export function ActionItemsList({ reviewId, items, canToggle }: { reviewId: string; items: ActionItemView[]; canToggle: boolean }) {
  const { pending, run } = useServerAction();
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            role="checkbox"
            aria-checked={i.done}
            disabled={!canToggle || pending}
            onClick={() => run(() => toggleActionItem(reviewId, i.id, !i.done), { successMessage: false })}
            className="flex w-full items-start gap-2.5 text-left text-[13px] disabled:cursor-default"
          >
            <span className={cn("mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px]", i.done ? "bg-success text-white" : "border-[1.5px] border-[#c4cad9] text-transparent")} aria-hidden>
              <Check className="size-3" strokeWidth={3} />
            </span>
            <span className={cn(i.done ? "text-muted line-through" : "text-ink")}>{i.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ReviewActions({
  reviewId,
  userId,
  firstName,
  today,
  status,
  acknowledged,
  isSelf,
  canEvaluate,
  canDelete,
  form,
}: {
  reviewId: string;
  userId: string;
  firstName: string;
  today: string;
  status: "draft" | "shared";
  acknowledged: boolean;
  isSelf: boolean;
  canEvaluate: boolean;
  canDelete: boolean;
  form: ReviewFormValues;
}) {
  const draft = status === "draft";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEvaluate && draft && (
        <>
          <ReviewFormButton userId={userId} firstName={firstName} today={today} initial={form} label="Edit draft" variant="secondary" size="sm" />
          <ActionButton size="sm" action={() => shareReview(reviewId)} confirm={`Share this evaluation with ${firstName}? They will be notified and can acknowledge it.`} successMessage="Evaluation shared">
            Share with {firstName}
          </ActionButton>
        </>
      )}
      {canDelete && draft && (
        <ActionButton size="sm" variant="danger-outline" action={() => deleteReview(reviewId)} confirm="Delete this draft evaluation?" successMessage="Draft deleted">
          Delete draft
        </ActionButton>
      )}
      {isSelf && !draft && !acknowledged && (
        <ReasonAction
          title="Acknowledge evaluation"
          description="Let your mentor know you've read it. You can add a comment."
          label="Comment"
          required={false}
          placeholder="Optional — thoughts or questions"
          confirmLabel="Acknowledge"
          successMessage="Evaluation acknowledged"
          action={(comment) => acknowledgeReview(reviewId, comment)}
          trigger={<Button size="sm">Acknowledge</Button>}
        />
      )}
    </div>
  );
}
