"use server";

import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { nextNumber } from "@/lib/counters";
import { db } from "@/lib/db";
import { Review, User, newId, type IReview } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { jsonPath, jsonPush } from "@/lib/sql";
import { fmtDate, todayKey } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { lifecycleEvent } from "../staff/_lib/person";
import { internAccess } from "./_lib/access";
import { averageRating, COMPETENCIES } from "./_lib/competencies";

/**
 * Atomic `$set` of fields inside the `User.internship` JSON column (`{ "internship.status": … }` before).
 * Dates are stored as ISO strings, objects / arrays as JSON.
 */
function setInternship(fields: Record<string, unknown>): SQL {
  const parts = Object.entries(fields).map(([key, value]) => {
    const path = `$.${key}`;
    if (value instanceof Date) return sql`${path}, ${value.toISOString()}`;
    if (value !== null && typeof value === "object") return sql`${path}, json(${JSON.stringify(value)})`;
    return sql`${path}, ${value}`;
  });
  return sql`json_set(${User.internship}, ${sql.join(parts, sql`, `)})`;
}

/** Atomic `$push` onto an array inside the `User.internship` JSON column (creating the array when missing). */
function pushInternship(key: string, item: unknown): SQL {
  const path = `$.${key}`;
  return sql`json_set(${User.internship}, ${path}, json_insert(coalesce(json_extract(${User.internship}, ${path}), '[]'), '$[#]', json(${JSON.stringify(item)})))`;
}

/** Loads an intern / trainee and the caller's access to it; throws when the record is not available. */
async function internTarget(user: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new ActionError("Person not found.");
  const [target] = await db()
    .select({
      _id: User._id,
      employeeId: User.employeeId,
      name: User.name,
      personType: User.personType,
      reportingManager: User.reportingManager,
      internship: User.internship,
    })
    .from(User)
    .where(eq(User._id, id))
    .limit(1);
  if (!target || (target.personType !== "intern" && target.personType !== "trainee")) throw new ActionError("Intern record not found.");
  return { target, access: internAccess(user, target) };
}

/** Objectives and evaluations are frozen once the internship has been completed or terminated. */
function assertInternshipOpen(target: { internship?: { status?: string } | null }): void {
  const status = target.internship?.status;
  if (status === "completed" || status === "terminated") throw new ActionError(`This internship is ${status}, so objectives and evaluations can no longer be changed.`);
}

/* ------------------------------------------------------------------ */
/* Objectives                                                          */
/* ------------------------------------------------------------------ */

export async function addObjective(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ userId: zs.id("Person"), text: zs.text("Objective", 300) }), input);
    const { target, access } = await internTarget(user, data.userId);
    if (!access.canRun) throw new ActionError("Only the mentor or an internship manager can set objectives.");
    if (!target.internship) throw new ActionError("This person has no internship record.");
    assertInternshipOpen(target);
    if ((target.internship.objectives ?? []).length >= 30) throw new ActionError("An internship can have at most 30 objectives.");
    await db()
      .update(User)
      .set({ internship: pushInternship("objectives", { _id: newId(), text: data.text, status: "open", updatedAt: new Date() }) })
      .where(eq(User._id, target._id));
    await audit(user, { action: "update", entity: "internship", entityId: target._id, ref: target.employeeId, summary: `Added an objective for ${target.name}: ${data.text.slice(0, 80)}` });
    await notify([target._id], { type: "internship", title: "A new internship objective was added", body: data.text, link: `/interns/${data.userId}` }, [user._id]);
    return null;
  }, "Objective added");
}

const objectiveStatuses = ["open", "in_progress", "achieved", "dropped"] as const;

export async function updateObjective(userId: string, objectiveId: string, status: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { target, access } = await internTarget(user, userId);
    if (!access.canRun) throw new ActionError("Only the mentor or an internship manager can update objectives.");
    assertInternshipOpen(target);
    if (!isObjectId(objectiveId)) throw new ActionError("Objective not found.");
    if (!(objectiveStatuses as readonly string[]).includes(status)) throw new ActionError("Choose a valid status.");
    const objectives = target.internship?.objectives ?? [];
    const objective = objectives.find((o) => o._id === objectiveId);
    if (!objective) throw new ActionError("Objective not found.");
    if (objective.status === status) return null;
    const next = objectives.map((o) =>
      o._id === objectiveId ? { ...o, status: status as (typeof objectiveStatuses)[number], updatedAt: new Date(), ...(note ? { note: note.slice(0, 500) } : {}) } : o,
    );
    await db().update(User).set({ internship: setInternship({ objectives: next }) }).where(eq(User._id, target._id));
    await audit(user, { action: "update", entity: "internship", entityId: target._id, ref: target.employeeId, summary: `Objective “${objective.text.slice(0, 60)}” for ${target.name}: ${objective.status} → ${status}`, changes: [{ field: "objective", from: objective.status, to: status }] });
    if (status === "achieved") {
      await notify([target._id], { type: "internship", title: "An objective was marked achieved", body: objective.text, link: `/interns/${userId}` }, [user._id]);
    }
    return null;
  }, "Objective updated");
}

/* ------------------------------------------------------------------ */
/* Evaluations                                                         */
/* ------------------------------------------------------------------ */

function rating(raw: unknown): number | null {
  const n = Number(raw);
  if (raw === "" || raw == null || !Number.isFinite(n) || n < 1 || n > 5) return null;
  return Math.round(n * 10) / 10;
}

const reviewSchema = z.object({
  userId: zs.id("Person"),
  reviewId: zs.optId(),
  periodLabel: zs.text("Evaluation period", 100),
  date: zs.date("Date"),
  strengths: zs.optText(3000),
  improvements: zs.optText(3000),
  actionItems: zs.list(),
  share: zs.bool(),
});

/** Creates or edits (drafts only) an evaluation; optionally shares it with the intern right away. */
export async function saveReview(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(reviewSchema, input);
    const { target, access } = await internTarget(user, data.userId);
    if (!access.canEvaluate) throw new ActionError("You can't record evaluations for this person.");
    assertInternshipOpen(target);

    const ratings: { key: string; label: string; score: number }[] = [];
    for (const c of COMPETENCIES) {
      const score = rating(input[`rating_${c.key}`]);
      if (score === null) throw new ActionError("Rate every competency from 1 to 5.", { [`rating_${c.key}`]: "Required" });
      ratings.push({ key: c.key, label: c.label, score });
    }
    const overall = rating(input.overall) ?? averageRating(ratings.map((r) => r.score));
    const actionItems = data.actionItems.slice(0, 20).map((text) => ({ _id: newId(), text: text.slice(0, 300), status: "open" as const }));
    const status: IReview["status"] = data.share ? "shared" : "draft";

    let reviewId: string;
    if (data.reviewId) {
      const [existing] = await db().select().from(Review).where(eq(Review._id, data.reviewId)).limit(1);
      if (!existing || existing.user !== data.userId) throw new ActionError("Evaluation not found.");
      if (existing.status !== "draft") throw new ActionError("Shared evaluations can't be edited.");
      if (existing.reviewer !== user.id && !access.canManage) throw new ActionError("Only the author can edit this draft.");
      await db()
        .update(Review)
        .set({ periodLabel: data.periodLabel, date: data.date, ratings, overall, strengths: data.strengths ?? "", improvements: data.improvements ?? "", actionItems, status })
        .where(and(eq(Review._id, existing._id), eq(Review.status, "draft")));
      reviewId = existing._id;
    } else {
      const [created] = await db()
        .insert(Review)
        .values({
          user: target._id,
          reviewer: user._id,
          reviewerName: user.name,
          periodLabel: data.periodLabel,
          date: data.date,
          ratings,
          overall,
          strengths: data.strengths,
          improvements: data.improvements,
          actionItems,
          status,
        })
        .returning({ _id: Review._id });
      reviewId = created._id;
    }

    await audit(user, {
      action: data.reviewId ? "update" : "create",
      entity: "review",
      entityId: reviewId,
      ref: target.employeeId,
      summary: `${data.reviewId ? "Updated" : "Recorded"} ${status} evaluation “${data.periodLabel}” for ${target.name}`,
    });
    if (status === "shared") {
      await notify([target._id], { type: "internship", title: "New evaluation shared with you", body: data.periodLabel, link: `/interns/${data.userId}?tab=evaluations`, actionable: true }, [user._id]);
    }
    return { id: reviewId };
  }, "Evaluation saved");
}

async function loadReview(user: CurrentUser, reviewId: string) {
  if (!isObjectId(reviewId)) throw new ActionError("Evaluation not found.");
  const [review] = await db().select().from(Review).where(eq(Review._id, reviewId)).limit(1);
  if (!review) throw new ActionError("Evaluation not found.");
  const { target, access } = await internTarget(user, review.user);
  return { review, target, access };
}

export async function shareReview(reviewId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { review, target, access } = await loadReview(user, reviewId);
    if (!access.canEvaluate) throw new ActionError("You can't share evaluations for this person.");
    const res = await db()
      .update(Review)
      .set({ status: "shared" })
      .where(and(eq(Review._id, review._id), eq(Review.status, "draft")))
      .returning({ id: Review._id });
    if (res.length === 0) throw new ActionError("This evaluation has already been shared.");
    await audit(user, { action: "update", entity: "review", entityId: review._id, ref: target.employeeId, summary: `Shared evaluation “${review.periodLabel}” with ${target.name}` });
    await notify([target._id], { type: "internship", title: "New evaluation shared with you", body: review.periodLabel, link: `/interns/${target._id}?tab=evaluations`, actionable: true }, [user._id]);
    return null;
  }, "Evaluation shared");
}

export async function deleteReview(reviewId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { review, target, access } = await loadReview(user, reviewId);
    if (!access.canEvaluate) throw new ActionError("You can't delete evaluations for this person.");
    if (review.status !== "draft") throw new ActionError("Only drafts can be deleted.");
    if (review.reviewer !== user.id && !access.canManage) throw new ActionError("Only the author can delete this draft.");
    await db().delete(Review).where(and(eq(Review._id, review._id), eq(Review.status, "draft")));
    await audit(user, { action: "delete", entity: "review", entityId: review._id, ref: target.employeeId, summary: `Deleted draft evaluation “${review.periodLabel}” for ${target.name}` });
    return null;
  }, "Draft deleted");
}

/** The intern acknowledges a shared evaluation and may leave a comment. */
export async function acknowledgeReview(reviewId: string, comment?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { review, target, access } = await loadReview(user, reviewId);
    if (!access.isSelf) throw new ActionError("Only the intern can acknowledge their evaluation.");
    if (review.status !== "shared") throw new ActionError("This evaluation hasn't been shared yet.");
    const text = (comment ?? "").trim().slice(0, 2000);
    const res = await db()
      .update(Review)
      .set({ acknowledgedAt: new Date(), ...(text ? { internComment: text } : {}) })
      .where(and(eq(Review._id, review._id), isNull(Review.acknowledgedAt)))
      .returning({ id: Review._id });
    if (res.length === 0) throw new ActionError("You have already acknowledged this evaluation.");
    await audit(user, { action: "update", entity: "review", entityId: review._id, ref: target.employeeId, summary: `${target.name} acknowledged evaluation “${review.periodLabel}”` });
    await notify([review.reviewer], { type: "internship", title: `${target.name} acknowledged their evaluation`, body: text || review.periodLabel, link: `/interns/${target._id}?tab=evaluations` }, [user._id]);
    return null;
  }, "Evaluation acknowledged");
}

export async function toggleActionItem(reviewId: string, itemId: string, done: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { review, access } = await loadReview(user, reviewId);
    if (!(access.canEvaluate || (access.isSelf && review.status === "shared"))) throw new ActionError("You can't update this action item.");
    if (!isObjectId(itemId)) throw new ActionError("Action item not found.");
    const item = review.actionItems.find((i) => i._id === itemId);
    if (!item) throw new ActionError("Action item not found.");
    const actionItems = review.actionItems.map((i) => {
      if (i._id !== itemId) return i;
      if (done) return { ...i, status: "done" as const, doneAt: new Date() };
      return { _id: i._id, text: i.text, status: "open" as const };
    });
    await db().update(Review).set({ actionItems }).where(eq(Review._id, review._id));
    return null;
  });
}

/* ------------------------------------------------------------------ */
/* Completion & certificate                                            */
/* ------------------------------------------------------------------ */

export async function completeInternship(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ userId: zs.id("Person"), note: zs.text("Completion note", 2000) }), input);
    const { target, access } = await internTarget(user, data.userId);
    if (!access.canRun) throw new ActionError("Only the mentor or an internship manager can complete an internship.");
    const status = target.internship?.status;
    if (!target.internship || !status || !["registered", "active", "extended"].includes(status)) throw new ActionError("This internship is already closed.");
    await db()
      .update(User)
      .set({
        internship: setInternship({ status: "completed", completedAt: new Date(), completionNote: data.note }),
        history: jsonPush(User.history, lifecycleEvent(user, { type: "status_change", summary: "Internship completed", from: status, to: "completed", note: data.note })),
      })
      .where(eq(User._id, target._id));
    await audit(user, { action: "status", entity: "internship", entityId: target._id, ref: target.employeeId, summary: `Marked the internship of ${target.name} as completed`, changes: [{ field: "internship.status", from: status, to: "completed" }] });
    await notify([target._id], { type: "internship", title: "Your internship has been marked completed", body: "You can now request your certificate from the Completion tab.", link: `/interns/${data.userId}?tab=completion` }, [user._id]);
    await notifyPermission("interns.manage", { type: "internship", title: `${target.name} completed their internship`, body: data.note.slice(0, 200), link: `/interns/${data.userId}?tab=completion` }, [user._id]);
    return null;
  }, "Internship marked completed");
}

export async function extendInternship(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ userId: zs.id("Person"), endDate: zs.date("New end date"), reason: zs.optText(1000) }), input);
    const { target, access } = await internTarget(user, data.userId);
    if (!access.canRun) throw new ActionError("Only the mentor or an internship manager can extend an internship.");
    const internship = target.internship;
    if (!internship || !["registered", "active", "extended"].includes(internship.status)) throw new ActionError("Only running internships can be extended.");
    if (internship.endDate && data.endDate <= internship.endDate) throw new ActionError("The new end date must be after the current end date.", { endDate: "Must be later than the current end date" });
    await db()
      .update(User)
      .set({
        internship: setInternship({ endDate: data.endDate, status: "extended" }),
        history: jsonPush(User.history, lifecycleEvent(user, { type: "status_change", summary: `Internship extended to ${fmtDate(data.endDate)}`, from: internship.endDate, to: data.endDate, note: data.reason })),
      })
      .where(eq(User._id, target._id));
    await audit(user, { action: "update", entity: "internship", entityId: target._id, ref: target.employeeId, summary: `Extended the internship of ${target.name} to ${data.endDate}`, changes: [{ field: "internship.endDate", from: internship.endDate, to: data.endDate }] });
    await notify([target._id, internship.mentor], { type: "internship", title: "Internship end date extended", body: `New end date: ${fmtDate(data.endDate)}.`, link: `/interns/${data.userId}` }, [user._id]);
    return null;
  }, "Internship extended");
}

export async function requestCertificate(userId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { target, access } = await internTarget(user, userId);
    if (!(access.isSelf || access.isMentor || access.canManage)) throw new ActionError("You can't request a certificate for this person.");
    const internship = target.internship;
    if (internship?.status !== "completed") throw new ActionError("The internship must be marked completed before a certificate can be requested.");
    const certificateStatus = jsonPath<string | null>(User.internship, "certificateStatus");
    const res = await db()
      .update(User)
      .set({ internship: setInternship({ certificateStatus: "requested" }) })
      .where(and(eq(User._id, target._id), or(isNull(certificateStatus), eq(certificateStatus, "none"))))
      .returning({ id: User._id });
    if (res.length === 0) throw new ActionError("A certificate has already been requested.");
    await audit(user, { action: "submit", entity: "certificate", entityId: target._id, ref: target.employeeId, summary: `Certificate requested for ${target.name}` });
    await notifyPermission("interns.manage", { type: "internship", title: `Certificate requested — ${target.name}`, body: "Approve the request to issue the internship certificate.", link: `/interns/${userId}?tab=completion`, actionable: true }, [user._id]);
    return null;
  }, "Certificate requested");
}

export async function approveCertificate(userId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("interns.manage");
    const { target } = await internTarget(user, userId);
    const res = await db()
      .update(User)
      .set({ internship: setInternship({ certificateStatus: "approved", certificateApprovedBy: user._id }) })
      .where(and(eq(User._id, target._id), eq(jsonPath(User.internship, "certificateStatus"), "requested")))
      .returning({ id: User._id });
    if (res.length === 0) throw new ActionError("There is no pending certificate request for this person.");
    await audit(user, { action: "approve", entity: "certificate", entityId: target._id, ref: target.employeeId, summary: `Approved the certificate for ${target.name}` });
    return null;
  }, "Certificate approved");
}

export async function issueCertificate(userId: string): Promise<ActionResult<{ certificateNo: string }>> {
  return runAction(async () => {
    const user = await actionPermission("interns.manage");
    const { target } = await internTarget(user, userId);
    if (target.internship?.certificateStatus !== "approved") throw new ActionError("Approve the certificate request before issuing it.");
    const settings = await getSettings();
    const certificateNo = await nextNumber("certificate", settings.numbering.certificatePrefix, 4);
    const res = await db()
      .update(User)
      .set({
        internship: setInternship({ certificateStatus: "issued", certificateNo, certificateIssuedAt: new Date() }),
        history: jsonPush(User.history, lifecycleEvent(user, { type: "note", date: todayKey(), summary: `Internship certificate ${certificateNo} issued` })),
      })
      .where(and(eq(User._id, target._id), eq(jsonPath(User.internship, "certificateStatus"), "approved")))
      .returning({ id: User._id });
    if (res.length === 0) throw new ActionError("This certificate has already been issued.");
    await audit(user, { action: "create", entity: "certificate", entityId: target._id, ref: certificateNo, summary: `Issued certificate ${certificateNo} to ${target.name}` });
    await notify([target._id, target.internship?.mentor], { type: "internship", title: "Your internship certificate is ready", body: `Certificate ${certificateNo} can be downloaded from the Completion tab.`, link: `/interns/${userId}?tab=completion` }, [user._id]);
    return { certificateNo };
  }, "Certificate issued");
}
