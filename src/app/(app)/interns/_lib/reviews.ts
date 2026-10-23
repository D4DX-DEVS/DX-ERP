import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Review } from "@/lib/models";
import type { ReviewView } from "../_components/review-card";

/** Evaluations of an intern as view-models. `sharedOnly` hides drafts (intern / manager view). */
export async function loadReviews(userId: string | Types.ObjectId, sharedOnly: boolean): Promise<ReviewView[]> {
  await connectDB();
  const rows = await Review.find({ user: userId, ...(sharedOnly ? { status: "shared" } : {}) })
    .sort({ date: -1, createdAt: -1 })
    .limit(100)
    .lean();
  return rows.map((r) => ({
    id: r._id.toString(),
    periodLabel: r.periodLabel,
    date: r.date,
    reviewerId: r.reviewer.toString(),
    reviewerName: r.reviewerName ?? "Reviewer",
    ratings: r.ratings.map((x) => ({ key: x.key, label: x.label, score: x.score })),
    overall: r.overall,
    strengths: r.strengths || undefined,
    improvements: r.improvements || undefined,
    actionItems: r.actionItems.map((i) => ({ id: i._id?.toString() ?? i.text, text: i.text, done: i.status === "done" })),
    status: r.status,
    acknowledgedAt: r.acknowledgedAt?.toISOString(),
    internComment: r.internComment || undefined,
  }));
}
