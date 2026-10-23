import { ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, SectionTitle } from "@/components/ui/page";
import { firstName } from "../../../staff/_lib/constants";
import { ReviewCard } from "../../_components/review-card";
import { ReviewFormButton } from "../../_components/review-form";
import { loadReviews } from "../../_lib/reviews";
import type { InternTabProps } from "./types";

/** Evaluations: evaluators see drafts too; the intern and their manager see shared ones only. */
export async function EvaluationsTab({ user, target, access, today }: InternTabProps) {
  const canSee = access.canEvaluate || access.isSelf || access.isManager;
  const reviews = canSee ? await loadReviews(target._id, !access.canEvaluate) : [];
  const id = target._id.toString();
  const first = firstName(target.name);
  const shared = reviews.filter((r) => r.status === "shared");
  const average = shared.length ? Math.round((shared.reduce((s, r) => s + r.overall, 0) / shared.length) * 10) / 10 : null;

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle
        action={access.canEvaluate && target.internship?.status !== "terminated" && target.internship?.status !== "completed" ? <ReviewFormButton userId={id} firstName={first} today={today} /> : undefined}
      >
        Evaluations
        {average !== null && <span className="ml-2 text-sm font-medium text-muted">average {average} / 5 across {shared.length} shared</span>}
      </SectionTitle>
      {!canSee ? (
        <Card>
          <EmptyState title="Evaluations are private" description="They are visible to the mentor, reviewers and the intern." />
        </Card>
      ) : reviews.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck className="size-5" />}
            title={access.isSelf ? "No evaluations shared with you yet" : "No evaluations yet"}
            description={access.canEvaluate ? "Record a progress evaluation to give structured feedback." : "Your mentor will share evaluations here."}
          />
        </Card>
      ) : (
        reviews.map((r) => (
          <ReviewCard key={r.id} review={r} userId={id} firstName={first} today={today} viewerId={user.id} isSelf={access.isSelf} canEvaluate={access.canEvaluate} canManage={access.canManage} />
        ))
      )}
    </div>
  );
}
