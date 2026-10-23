import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { Review, type Id } from "@/lib/models";
import type { ReviewView } from "../_components/review-card";

/** Evaluations of an intern as view-models. `sharedOnly` hides drafts (intern / manager view). */
export async function loadReviews(userId: Id, sharedOnly: boolean): Promise<ReviewView[]> {
  const rows = await db()
    .select()
    .from(Review)
    .where(and(eq(Review.user, userId), sharedOnly ? eq(Review.status, "shared") : undefined))
    .orderBy(desc(Review.date), desc(Review.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r._id,
    periodLabel: r.periodLabel,
    date: r.date,
    reviewerId: r.reviewer,
    reviewerName: r.reviewerName ?? "Reviewer",
    ratings: r.ratings.map((x) => ({ key: x.key, label: x.label, score: x.score })),
    overall: r.overall ?? 0,
    strengths: r.strengths || undefined,
    improvements: r.improvements || undefined,
    actionItems: r.actionItems.map((i) => ({ id: i._id ?? i.text, text: i.text, done: i.status === "done" })),
    status: r.status,
    acknowledgedAt: r.acknowledgedAt?.toISOString(),
    internComment: r.internComment || undefined,
  }));
}
