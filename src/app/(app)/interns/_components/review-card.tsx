import { Chip } from "@/components/ui/chip";
import { Card, CardBody } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { ActionItemsList, ReviewActions, type ActionItemView } from "./review-actions";
import type { ReviewFormValues } from "./review-form";

export interface ReviewView {
  id: string;
  periodLabel: string;
  date: string;
  reviewerId: string;
  reviewerName: string;
  ratings: { key: string; label: string; score: number }[];
  overall: number;
  strengths?: string;
  improvements?: string;
  actionItems: ActionItemView[];
  status: "draft" | "shared";
  acknowledgedAt?: string;
  internComment?: string;
}

export function RatingDots({ score }: { score: number }) {
  const filled = Math.round(score);
  return (
    <span className="flex gap-[3px]" role="img" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cn("h-1.5 w-5 rounded-full", n <= filled ? "bg-tone-purple" : "bg-track")} />
      ))}
    </span>
  );
}

/** One evaluation: ratings, narrative feedback, action items, acknowledgement and author controls. */
export function ReviewCard({
  review,
  userId,
  firstName,
  today,
  viewerId,
  isSelf,
  canEvaluate,
  canManage,
}: {
  review: ReviewView;
  userId: string;
  firstName: string;
  today: string;
  viewerId: string;
  isSelf: boolean;
  canEvaluate: boolean;
  canManage: boolean;
}) {
  const form: ReviewFormValues = {
    id: review.id,
    periodLabel: review.periodLabel,
    date: review.date,
    scores: Object.fromEntries(review.ratings.map((r) => [r.key, r.score])),
    overall: review.overall,
    strengths: review.strengths ?? "",
    improvements: review.improvements ?? "",
    actionItems: review.actionItems.map((i) => i.text),
  };
  const canToggle = canEvaluate || (isSelf && review.status === "shared");
  const canDelete = canEvaluate && (review.reviewerId === viewerId || canManage);
  return (
    <Card>
      <CardBody className="flex flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-[17px] font-semibold text-ink">{review.periodLabel}</h3>
            <p className="text-[13px] text-muted">
              {fmtDate(review.date)} · by {review.reviewerName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-semibold text-ink tabular">
              {review.overall}
              <span className="text-sm font-medium text-muted"> / 5</span>
            </span>
            <StatusChip domain="review" value={review.status} />
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {review.ratings.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-ink-2">{r.label}</span>
              <span className="flex items-center gap-2">
                <RatingDots score={r.score} />
                <span className="w-6 text-right font-semibold text-ink tabular">{r.score}</span>
              </span>
            </div>
          ))}
        </div>

        {(review.strengths || review.improvements) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {review.strengths && (
              <div>
                <div className="mb-1 text-xs font-semibold text-muted">Strengths</div>
                <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{review.strengths}</p>
              </div>
            )}
            {review.improvements && (
              <div>
                <div className="mb-1 text-xs font-semibold text-muted">Areas to improve</div>
                <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{review.improvements}</p>
              </div>
            )}
          </div>
        )}

        {review.actionItems.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted">
              Action items · {review.actionItems.filter((i) => i.done).length} / {review.actionItems.length} done
            </div>
            <ActionItemsList reviewId={review.id} items={review.actionItems} canToggle={canToggle} />
          </div>
        )}

        {review.acknowledgedAt && (
          <div className="rounded-xl bg-field px-3.5 py-2.5 text-[13px]">
            <Chip tone="green" size="sm">
              Acknowledged {fmtDateTime(review.acknowledgedAt)}
            </Chip>
            {review.internComment && <p className="mt-1.5 whitespace-pre-line text-ink-2">“{review.internComment}”</p>}
          </div>
        )}

        <ReviewActions
          reviewId={review.id}
          userId={userId}
          firstName={firstName}
          today={today}
          status={review.status}
          acknowledged={Boolean(review.acknowledgedAt)}
          isSelf={isSelf}
          canEvaluate={canEvaluate}
          canDelete={canDelete}
          form={form}
        />
      </CardBody>
    </Card>
  );
}
