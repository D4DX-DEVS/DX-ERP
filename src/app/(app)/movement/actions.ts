"use server";

import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Movement, Project, User, newId, type IMovement } from "@/lib/models";
import { inList, jsonPush } from "@/lib/sql";
import { nextNumber, ID_PREFIX } from "@/lib/counters";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { notify, notifyPermission, usersWithPermission } from "@/lib/notify";
import { recalcAttendanceDay, recalcAttendanceDays } from "@/lib/domain/attendance-calc";
import { canApproveMovement, categoryOf, SELF_CANCEL_MINUTES, withinSelfCancelWindow } from "@/lib/movement/access";
import { addDays, dateKey, fmtDateTime, fmtTime, minutesBetween, parseLocalDateTime, todayKey, formatDuration } from "@/lib/time";
import { zs } from "@/lib/validation";
import { isObjectId } from "@/lib/validation";

function history(user: Pick<CurrentUser, "_id" | "name">, action: string, note?: string, from?: string, to?: string) {
  return { _id: newId(), action, by: user._id, byName: user.name, at: new Date(), note, from, to };
}

async function loadMovement(id: string): Promise<IMovement> {
  if (!isObjectId(id)) throw new ActionError("Movement not found.");
  const [m] = await db().select().from(Movement).where(eq(Movement._id, id)).limit(1);
  if (!m) throw new ActionError("Movement not found.");
  return m;
}

/** Who should decide on a movement: the reporting manager, otherwise everyone with `movement.approve`. */
async function approverIds(userId: string): Promise<{ manager?: string; ids: string[] }> {
  const [person] = await db().select({ reportingManager: User.reportingManager }).from(User).where(eq(User._id, userId)).limit(1);
  const manager = person?.reportingManager ?? undefined;
  if (manager) return { manager, ids: [manager] };
  return { ids: await usersWithPermission("movement.approve") };
}

async function validateReferences(projectId?: string, clientId?: string): Promise<{ project?: string; client?: string }> {
  const out: { project?: string; client?: string } = {};
  if (projectId) {
    const [p] = await db().select({ _id: Project._id, client: Project.client }).from(Project).where(eq(Project._id, projectId)).limit(1);
    if (!p) throw new ActionError("Selected project was not found.", { project: "Not found" });
    out.project = p._id;
    if (p.client) out.client = p.client;
  }
  if (clientId) {
    const [c] = await db().select({ _id: Client._id }).from(Client).where(eq(Client._id, clientId)).limit(1);
    if (!c) throw new ActionError("Selected client was not found.", { client: "Not found" });
    out.client = c._id;
  }
  return out;
}

const CHANGED = "This movement was just changed. Reload and try again.";

/* ------------------------------------------------------------------ */
/* Going out — records Out-Time on confirmation (FRS §8.4 steps 1–4)   */
/* ------------------------------------------------------------------ */

const startSchema = z.object({
  category: zs.text("Category", 60),
  purpose: zs.text("Purpose", 500),
  destination: zs.optText(300),
  project: zs.optId(),
  client: zs.optId(),
  expectedReturn: zs.optDateTime(),
  remarks: zs.optText(1000),
  onBehalfOf: zs.optId(),
});

export async function startMovement(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await actionUser();
    const data = parse(startSchema, input);
    const settings = await getSettings();

    let subjectId: string = actor._id;
    if (data.onBehalfOf && data.onBehalfOf !== actor.id) {
      if (!can(actor, "movement.manage")) throw new ActionError("You can't record movements for other people.");
      const [subject] = await db().select({ _id: User._id, personType: User.personType }).from(User).where(eq(User._id, data.onBehalfOf)).limit(1);
      if (!subject || subject.personType === "admin") throw new ActionError("Person not found.", { onBehalfOf: "Not found" });
      subjectId = subject._id;
    } else if (!isStaff(actor)) {
      throw new ActionError("The administrator account does not record movements. Choose a person to record on behalf of.");
    }

    const category = categoryOf(settings, data.category);
    if (!category || !category.active) throw new ActionError("Choose a valid category.", { category: "Invalid category" });

    const [open] = await db().select({ movementNo: Movement.movementNo }).from(Movement).where(and(eq(Movement.user, subjectId), eq(Movement.status, "out"))).limit(1);
    if (open) throw new ActionError(`There is already an open movement (${open.movementNo}). Record its In-Time first.`);

    const now = new Date();
    const expectedReturn = parseLocalDateTime(data.expectedReturn);
    if (settings.movement.requireExpectedReturn && !expectedReturn) {
      throw new ActionError("Enter the expected return time.", { expectedReturn: "Required" });
    }
    if (expectedReturn && expectedReturn.getTime() <= now.getTime()) {
      throw new ActionError("Expected return must be later than now.", { expectedReturn: "Must be in the future" });
    }
    if (expectedReturn && expectedReturn.getTime() - now.getTime() > 24 * 3_600_000) {
      throw new ActionError("Expected return must be within 24 hours. Use leave for longer absences.", { expectedReturn: "Too far ahead" });
    }

    const refs = await validateReferences(data.project, data.client);
    const { manager, ids } = await approverIds(subjectId);
    const needsApproval = category.requiresApproval;
    const onBehalf = subjectId !== actor.id;

    const [doc] = await db()
      .insert(Movement)
      .values({
        movementNo: await nextNumber("movement", ID_PREFIX.movement, 6),
        user: subjectId,
        date: dateKey(now),
        outTime: now,
        expectedReturn: expectedReturn ?? undefined,
        category: category.key,
        categoryLabel: category.label,
        official: category.official,
        purpose: data.purpose,
        destination: data.destination,
        project: refs.project,
        client: refs.client,
        remarks: data.remarks,
        status: "out",
        approvalStatus: needsApproval ? "pending" : "not_required",
        approver: needsApproval && manager ? manager : undefined,
        entryMode: "live",
        enteredBy: actor._id,
        enteredByName: actor.name,
        history: [history(actor, onBehalf ? "Out-Time recorded on behalf" : "Out-Time recorded", undefined, undefined, fmtTime(now))],
      })
      .returning();

    const [subject] = onBehalf ? await db().select({ name: User.name }).from(User).where(eq(User._id, subjectId)).limit(1) : [];
    const personName = subject?.name ?? actor.name;
    await audit(actor, {
      action: "create",
      entity: "movement",
      entityId: doc._id,
      ref: doc.movementNo,
      summary: `${onBehalf ? `${actor.name} recorded` : "Recorded"} movement ${doc.movementNo} for ${personName} (${category.label})`,
    });

    if (needsApproval) {
      await notify(
        ids,
        {
          type: "movement",
          title: `Movement needs approval: ${personName}`,
          body: `${category.label}${category.official ? ` · ${data.purpose}` : ""} · out ${fmtTime(now)}${expectedReturn ? `, back by ${fmtTime(expectedReturn)}` : ""}`,
          link: `/movement/${doc._id}`,
          actionable: true,
        },
        [subjectId],
      );
    } else if (manager) {
      await notify([manager], {
        type: "movement",
        title: `${personName} is out of the office`,
        body: `${category.label} · out ${fmtTime(now)}${expectedReturn ? `, back by ${fmtTime(expectedReturn)}` : ""}`,
        link: `/movement/${doc._id}`,
      }, [subjectId]);
    }
    if (onBehalf) {
      await notify([subjectId], { type: "movement", title: "A movement was recorded for you", body: `${actor.name} recorded ${doc.movementNo} (${category.label}).`, link: `/movement/${doc._id}` });
    }
    return { id: doc._id };
  }, "Out-Time recorded");
}

/* ------------------------------------------------------------------ */
/* Return — records In-Time and calculates duration (§8.4 steps 5–8)   */
/* ------------------------------------------------------------------ */

export async function recordInTime(id: string): Promise<ActionResult<{ duration: string }>> {
  return runAction(async () => {
    const actor = await actionUser();
    const m = await loadMovement(id);
    if (m.user !== actor.id) throw new ActionError("Only the person who is out can record their In-Time. Authorised users can resolve it instead.");
    if (m.status !== "out" || !m.outTime) throw new ActionError("This movement is not open.");
    const now = new Date();
    const durationMinutes = minutesBetween(m.outTime, now);
    const late = m.expectedReturn && now.getTime() > m.expectedReturn.getTime();
    const [updated] = await db()
      .update(Movement)
      .set({
        inTime: now,
        durationMinutes,
        status: "returned",
        history: jsonPush(
          Movement.history,
          history(actor, "In-Time recorded", late ? `Returned ${formatDuration(minutesBetween(m.expectedReturn!, now))} after expected time` : undefined, undefined, fmtTime(now)),
        ),
      })
      .where(and(eq(Movement._id, m._id), eq(Movement.status, "out")))
      .returning({ id: Movement._id });
    if (!updated) throw new ActionError("This movement is not open.");
    await recalcAttendanceDay(m.user, m.date);
    await audit(actor, { action: "update", entity: "movement", entityId: m._id, ref: m.movementNo, summary: `In-Time recorded for ${m.movementNo} (${formatDuration(durationMinutes)})` });
    return { duration: formatDuration(durationMinutes) };
  }, "Welcome back — In-Time recorded");
}

const returnSchema = z.object({ expectedReturn: zs.dateTime("Expected return"), note: zs.optText(300) });

export async function updateExpectedReturn(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const data = parse(returnSchema, input);
    const m = await loadMovement(id);
    if (m.user !== actor.id && !can(actor, "movement.manage")) throw new ActionError("You can't change this movement.");
    if (m.status !== "out") throw new ActionError("Only open movements can be extended.");
    const next = parseLocalDateTime(data.expectedReturn);
    if (!next || next.getTime() <= Date.now()) throw new ActionError("Choose a time later than now.", { expectedReturn: "Must be in the future" });
    const before = m.expectedReturn;
    const [saved] = await db()
      .update(Movement)
      .set({
        expectedReturn: next,
        overdueNotifiedAt: null,
        history: jsonPush(Movement.history, history(actor, "Expected return updated", data.note, before ? fmtTime(before) : undefined, fmtTime(next))),
      })
      .where(and(eq(Movement._id, m._id), eq(Movement.status, "out")))
      .returning({ id: Movement._id });
    if (!saved) throw new ActionError("Only open movements can be extended.");
    await audit(actor, {
      action: "update",
      entity: "movement",
      entityId: m._id,
      ref: m.movementNo,
      summary: `Expected return of ${m.movementNo} changed`,
      changes: [{ field: "expectedReturn", from: before, to: next }],
    });
    const { manager } = await approverIds(m.user);
    if (manager && manager !== actor.id) {
      await notify([manager], { type: "movement", title: `Return time updated · ${m.movementNo}`, body: `Now expected back at ${fmtTime(next)}${data.note ? ` — ${data.note}` : ""}`, link: `/movement/${m._id}` });
    }
    return null;
  }, "Expected return updated");
}

export async function cancelMovement(id: string, rawReason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const reason = parse(zs.text("Reason", 500), rawReason);
    const m = await loadMovement(id);
    const own = m.user === actor.id;
    if (!own && !can(actor, "movement.manage")) throw new ActionError("You can't cancel this movement.");
    if (m.status !== "out") throw new ActionError("Only open movements can be cancelled.");
    if (own && m.date !== todayKey()) throw new ActionError("This movement is from an earlier day. Request a correction or ask HR to resolve it.");
    if (own && !can(actor, "movement.manage") && !withinSelfCancelWindow(m)) {
      throw new ActionError(`A movement can only be cancelled within ${SELF_CANCEL_MINUTES} minutes of its Out-Time. Record your In-Time and request a correction, or ask HR to resolve it.`);
    }
    const [cancelled] = await db()
      .update(Movement)
      .set({
        status: "cancelled",
        ...(m.approvalStatus === "pending" ? { approvalStatus: "not_required" as const } : {}),
        history: jsonPush(Movement.history, history(actor, "Cancelled", reason.trim())),
      })
      .where(and(eq(Movement._id, m._id), eq(Movement.status, "out")))
      .returning({ id: Movement._id });
    if (!cancelled) throw new ActionError("Only open movements can be cancelled.");
    await recalcAttendanceDay(m.user, m.date);
    await audit(actor, { action: "cancel", entity: "movement", entityId: m._id, ref: m.movementNo, summary: `Cancelled ${m.movementNo}: ${reason.trim()}` });
    const { manager } = await approverIds(m.user);
    await notify([manager, m.user], { type: "movement", title: `Movement cancelled · ${m.movementNo}`, body: `${actor.name}: ${reason.trim()}`, link: `/movement/${m._id}` }, [actor._id]);
    return null;
  }, "Movement cancelled");
}

/* ------------------------------------------------------------------ */
/* Alternative entry — recorded afterwards, always reviewed (§8.4)     */
/* ------------------------------------------------------------------ */

const lateSchema = z.object({
  category: zs.text("Category", 60),
  purpose: zs.text("Purpose", 500),
  destination: zs.optText(300),
  project: zs.optId(),
  client: zs.optId(),
  outTime: zs.dateTime("Out-Time"),
  expectedReturn: zs.optDateTime(),
  inTime: zs.optDateTime(),
  remarks: zs.optText(1000),
  reason: zs.text("Reason for late entry", 500),
  onBehalfOf: zs.optId(),
});

export async function addLateEntry(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const actor = await actionUser();
    const data = parse(lateSchema, input);
    const settings = await getSettings();

    let subjectId: string = actor._id;
    if (data.onBehalfOf && data.onBehalfOf !== actor.id) {
      if (!can(actor, "movement.manage")) throw new ActionError("You can't record movements for other people.");
      const [subject] = await db().select({ _id: User._id, personType: User.personType }).from(User).where(eq(User._id, data.onBehalfOf)).limit(1);
      if (!subject || subject.personType === "admin") throw new ActionError("Person not found.", { onBehalfOf: "Not found" });
      subjectId = subject._id;
    } else if (!isStaff(actor)) {
      throw new ActionError("Choose the person this movement belongs to.", { onBehalfOf: "Required" });
    }

    const category = categoryOf(settings, data.category);
    if (!category || !category.active) throw new ActionError("Choose a valid category.", { category: "Invalid category" });

    const outTime = parseLocalDateTime(data.outTime)!;
    const inTime = parseLocalDateTime(data.inTime);
    const expectedReturn = parseLocalDateTime(data.expectedReturn);
    const now = new Date();
    if (outTime.getTime() > now.getTime()) throw new ActionError("Out-Time can't be in the future.", { outTime: "In the future" });
    const earliest = addDays(todayKey(), -settings.movement.alternativeEntryMaxDays);
    if (dateKey(outTime) < earliest && !can(actor, "movement.manage")) {
      throw new ActionError(`Late entries are allowed for the last ${settings.movement.alternativeEntryMaxDays} days. Contact HR for older records.`, { outTime: "Too old" });
    }
    if (inTime && inTime.getTime() <= outTime.getTime()) throw new ActionError("In-Time must be after Out-Time.", { inTime: "Must be after Out-Time" });
    if (inTime && inTime.getTime() > now.getTime()) throw new ActionError("In-Time can't be in the future.", { inTime: "In the future" });
    if (inTime && minutesBetween(outTime, inTime) > 24 * 60) throw new ActionError("A movement can't be longer than 24 hours.", { inTime: "Too long" });

    if (!inTime) {
      const [open] = await db().select({ movementNo: Movement.movementNo }).from(Movement).where(and(eq(Movement.user, subjectId), eq(Movement.status, "out"))).limit(1);
      if (open) throw new ActionError(`There is already an open movement (${open.movementNo}).`);
    }
    const [overlap] = await db()
      .select({ movementNo: Movement.movementNo })
      .from(Movement)
      .where(
        and(
          eq(Movement.user, subjectId),
          inList(Movement.status, ["out", "returned"]),
          lt(Movement.outTime, inTime ?? now),
          or(gt(Movement.inTime, outTime), eq(Movement.status, "out")),
        ),
      )
      .limit(1);
    if (overlap) throw new ActionError(`These times overlap movement ${overlap.movementNo}.`, { outTime: "Overlaps another movement" });

    const refs = await validateReferences(data.project, data.client);
    const { manager, ids } = await approverIds(subjectId);
    const onBehalf = subjectId !== actor.id;
    const [doc] = await db()
      .insert(Movement)
      .values({
        movementNo: await nextNumber("movement", ID_PREFIX.movement, 6),
        user: subjectId,
        date: dateKey(outTime),
        outTime,
        expectedReturn: expectedReturn ?? undefined,
        inTime: inTime ?? undefined,
        durationMinutes: inTime ? minutesBetween(outTime, inTime) : undefined,
        category: category.key,
        categoryLabel: category.label,
        official: category.official,
        purpose: data.purpose,
        destination: data.destination,
        project: refs.project,
        client: refs.client,
        remarks: data.remarks,
        status: inTime ? "returned" : "out",
        // Alternative entries are always reviewed, whatever the category.
        approvalStatus: "pending",
        approver: manager,
        entryMode: "alternative",
        alternativeReason: data.reason,
        enteredBy: actor._id,
        enteredByName: actor.name,
        history: [history(actor, "Late entry recorded", data.reason, undefined, `${fmtDateTime(outTime)}${inTime ? ` → ${fmtTime(inTime)}` : ""}`)],
      })
      .returning();
    if (inTime) await recalcAttendanceDay(subjectId, doc.date);

    const person = onBehalf ? ((await db().select({ name: User.name }).from(User).where(eq(User._id, subjectId)).limit(1))[0]?.name ?? "") : actor.name;
    await audit(actor, {
      action: "create",
      entity: "movement",
      entityId: doc._id,
      ref: doc.movementNo,
      summary: `Late entry ${doc.movementNo} for ${person}: ${data.reason}`,
    });
    await notify(ids, {
      type: "movement",
      title: `Late movement entry to review: ${person}`,
      body: `${category.label} · ${fmtDateTime(outTime)}${inTime ? ` – ${fmtTime(inTime)}` : " (no In-Time)"} · ${data.reason}`,
      link: `/movement/${doc._id}`,
      actionable: true,
    }, [subjectId, actor._id]);
    return { id: doc._id };
  }, "Late entry submitted for approval");
}

/* ------------------------------------------------------------------ */
/* Approval                                                           */
/* ------------------------------------------------------------------ */

async function decide(id: string, approve: boolean, note?: string): Promise<IMovement> {
  const actor = await actionUser();
  const m = await loadMovement(id);
  if (!(await canApproveMovement(actor, m))) throw new ActionError("You can't approve this movement.");
  if (m.approvalStatus !== "pending") throw new ActionError("This movement is not waiting for approval.");
  if (!approve && !note?.trim()) throw new ActionError("A reason is required to reject.");
  const [updated] = await db()
    .update(Movement)
    .set({
      approvalStatus: approve ? "approved" : "rejected",
      approvedBy: actor._id,
      approvedByName: actor.name,
      approvedAt: new Date(),
      approvalNote: note?.trim() || null,
      history: jsonPush(Movement.history, history(actor, approve ? "Approved" : "Rejected", note?.trim())),
    })
    .where(and(eq(Movement._id, m._id), eq(Movement.approvalStatus, "pending")))
    .returning();
  if (!updated) throw new ActionError("This movement is not waiting for approval.");
  if (updated.status === "returned") await recalcAttendanceDay(updated.user, updated.date);
  await audit(actor, {
    action: approve ? "approve" : "reject",
    entity: "movement",
    entityId: updated._id,
    ref: updated.movementNo,
    summary: `${approve ? "Approved" : "Rejected"} movement ${updated.movementNo}${note ? `: ${note}` : ""}`,
  });
  await notify([updated.user], {
    type: "movement",
    title: `Movement ${updated.movementNo} ${approve ? "approved" : "rejected"}`,
    body: `${actor.name}${note ? `: ${note}` : ""}`,
    link: `/movement/${updated._id}`,
    priority: approve ? "normal" : "high",
  });
  return updated;
}

export async function approveMovement(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await decide(id, true, note);
    return null;
  }, "Movement approved");
}

export async function rejectMovement(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await decide(id, false, reason);
    return null;
  }, "Movement rejected");
}

/* ------------------------------------------------------------------ */
/* Corrections — originals preserved, every change logged (§8.8)       */
/* ------------------------------------------------------------------ */

const correctionSchema = z.object({ outTime: zs.dateTime("Out-Time"), inTime: zs.optDateTime(), reason: zs.text("Reason", 1000) });

export async function requestCorrection(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const data = parse(correctionSchema, input);
    const m = await loadMovement(id);
    if (m.user !== actor.id) throw new ActionError("Only the person can request a correction to their movement.");
    if (m.status === "cancelled") throw new ActionError("Cancelled movements can't be corrected.");
    if (m.corrections.some((c) => c.status === "pending")) throw new ActionError("A correction is already waiting for review.");
    const outTime = parseLocalDateTime(data.outTime)!;
    const inTime = parseLocalDateTime(data.inTime);
    const now = new Date();
    if (outTime.getTime() > now.getTime()) throw new ActionError("Out-Time can't be in the future.", { outTime: "In the future" });
    if (m.status === "returned" && !inTime) throw new ActionError("Enter the correct In-Time.", { inTime: "Required" });
    if (inTime && inTime.getTime() <= outTime.getTime()) throw new ActionError("In-Time must be after Out-Time.", { inTime: "Must be after Out-Time" });
    if (inTime && inTime.getTime() > now.getTime()) throw new ActionError("In-Time can't be in the future.", { inTime: "In the future" });
    const sameOut = m.outTime && Math.abs(m.outTime.getTime() - outTime.getTime()) < 60_000;
    const sameIn = (!inTime && !m.inTime) || (inTime && m.inTime && Math.abs(m.inTime.getTime() - inTime.getTime()) < 60_000);
    if (sameOut && sameIn) throw new ActionError("The proposed times are the same as the recorded ones.");

    const correction = {
      _id: newId(),
      requestedBy: actor._id,
      requestedByName: actor.name,
      requestedAt: now,
      reason: data.reason,
      proposedOutTime: outTime,
      proposedInTime: inTime ?? undefined,
      originalOutTime: m.outTime ?? undefined,
      originalInTime: m.inTime ?? undefined,
      previousApprovalStatus: m.approvalStatus,
      status: "pending" as const,
    };
    const [saved] = await db()
      .update(Movement)
      .set({
        corrections: jsonPush(Movement.corrections, correction),
        approvalStatus: "correction_requested",
        history: jsonPush(
          Movement.history,
          history(actor, "Correction requested", data.reason, `${m.outTime ? fmtDateTime(m.outTime) : "—"} → ${m.inTime ? fmtTime(m.inTime) : "—"}`, `${fmtDateTime(outTime)} → ${inTime ? fmtTime(inTime) : "—"}`),
        ),
      })
      // Guard: nothing changed since it was read (e.g. no other correction was requested in the meantime).
      .where(and(eq(Movement._id, m._id), eq(Movement.approvalStatus, m.approvalStatus), eq(Movement.updatedAt, m.updatedAt)))
      .returning({ id: Movement._id });
    if (!saved) throw new ActionError(CHANGED);
    await audit(actor, {
      action: "correct",
      entity: "movement",
      entityId: m._id,
      ref: m.movementNo,
      summary: `Correction requested for ${m.movementNo}: ${data.reason}`,
      changes: [
        { field: "outTime", from: correction.originalOutTime, to: outTime },
        { field: "inTime", from: correction.originalInTime, to: inTime },
      ],
    });
    const { ids } = await approverIds(m.user);
    await notify(ids, {
      type: "movement",
      title: `Movement correction requested: ${actor.name}`,
      body: `${m.movementNo} · ${data.reason}`,
      link: `/movement/${m._id}`,
      actionable: true,
    }, [actor._id]);
    return null;
  }, "Correction submitted for review");
}

export async function decideCorrection(id: string, correctionId: string, approve: boolean, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const m = await loadMovement(id);
    if (!(await canApproveMovement(actor, m))) throw new ActionError("You can't review corrections for this movement.");
    const found = m.corrections.find((x) => x._id === correctionId);
    if (!found || found.status !== "pending") throw new ActionError("This correction is no longer pending.");
    if (!approve && !note?.trim()) throw new ActionError("A reason is required to reject.");

    const oldDate = m.date;
    const c = {
      ...found,
      status: approve ? ("approved" as const) : ("rejected" as const),
      reviewedBy: actor._id,
      reviewedByName: actor.name,
      reviewedAt: new Date(),
      reviewNote: note?.trim() || undefined,
    };
    // Original timestamps stay on the correction record (originalOutTime / originalInTime).
    const patch: SQLiteUpdateSetSource<typeof Movement> = {
      corrections: m.corrections.map((x) => (x._id === correctionId ? c : x)),
      approvalStatus: c.previousApprovalStatus && c.previousApprovalStatus !== "correction_requested" ? c.previousApprovalStatus : "not_required",
      history: jsonPush(Movement.history, history(actor, approve ? "Correction approved" : "Correction rejected", note?.trim())),
    };
    let newDate = m.date;
    if (approve && c.proposedOutTime) {
      patch.outTime = c.proposedOutTime;
      newDate = dateKey(c.proposedOutTime);
      patch.date = newDate;
      if (c.proposedInTime) {
        patch.inTime = c.proposedInTime;
        patch.status = "returned";
        patch.durationMinutes = minutesBetween(c.proposedOutTime, c.proposedInTime);
      } else if (m.inTime) {
        patch.durationMinutes = minutesBetween(c.proposedOutTime, m.inTime);
      }
    }
    const [saved] = await db()
      .update(Movement)
      .set(patch)
      // Guard: the correction must still be pending (it can only be decided once).
      .where(
        and(
          eq(Movement._id, m._id),
          sql`exists (select 1 from json_each(${Movement.corrections}) where json_extract(value, '$._id') = ${correctionId} and json_extract(value, '$.status') = 'pending')`,
        ),
      )
      .returning({ id: Movement._id });
    if (!saved) throw new ActionError("This correction is no longer pending.");
    if (approve) await recalcAttendanceDays(m.user, oldDate !== newDate ? [newDate, oldDate] : [newDate]);
    await audit(actor, {
      action: approve ? "approve" : "reject",
      entity: "movement",
      entityId: m._id,
      ref: m.movementNo,
      summary: `${approve ? "Approved" : "Rejected"} correction to ${m.movementNo}${note ? `: ${note}` : ""}`,
      changes: approve
        ? [
            { field: "outTime", from: c.originalOutTime, to: c.proposedOutTime },
            { field: "inTime", from: c.originalInTime, to: c.proposedInTime },
          ]
        : undefined,
    });
    await notify([c.requestedBy], {
      type: "movement",
      title: `Correction to ${m.movementNo} ${approve ? "approved" : "rejected"}`,
      body: `${actor.name}${note ? `: ${note}` : ""}`,
      link: `/movement/${m._id}`,
    });
    return null;
  }, approve ? "Correction approved" : "Correction rejected");
}

/* ------------------------------------------------------------------ */
/* Resolution of open movements by authorised users (§8.5)             */
/* ------------------------------------------------------------------ */

const resolveSchema = z.object({ inTime: zs.dateTime("In-Time"), note: zs.text("Note", 500) });

export async function resolveMovement(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionPermission("movement.manage");
    const data = parse(resolveSchema, input);
    const m = await loadMovement(id);
    if (m.status !== "out" || !m.outTime) throw new ActionError("Only open movements can be resolved.");
    if (m.user === actor.id) throw new ActionError("You can't resolve your own movement. Record your In-Time instead.");
    const inTime = parseLocalDateTime(data.inTime)!;
    if (inTime.getTime() <= m.outTime.getTime()) throw new ActionError("In-Time must be after Out-Time.", { inTime: "Must be after Out-Time" });
    if (inTime.getTime() > Date.now()) throw new ActionError("In-Time can't be in the future.", { inTime: "In the future" });
    const [resolved] = await db()
      .update(Movement)
      .set({
        inTime,
        durationMinutes: minutesBetween(m.outTime, inTime),
        status: "returned",
        resolvedBy: actor._id,
        resolvedByName: actor.name,
        resolutionNote: data.note,
        history: jsonPush(Movement.history, history(actor, "Resolved by authorised user", data.note, undefined, fmtDateTime(inTime))),
      })
      .where(and(eq(Movement._id, m._id), eq(Movement.status, "out")))
      .returning({ id: Movement._id });
    if (!resolved) throw new ActionError("Only open movements can be resolved.");
    await recalcAttendanceDay(m.user, m.date);
    await audit(actor, {
      action: "correct",
      entity: "movement",
      entityId: m._id,
      ref: m.movementNo,
      summary: `Resolved open movement ${m.movementNo} with In-Time ${fmtDateTime(inTime)}: ${data.note}`,
      changes: [{ field: "inTime", from: undefined, to: inTime }],
    });
    await notify([m.user], { type: "movement", title: `Movement ${m.movementNo} was closed by ${actor.name}`, body: `In-Time set to ${fmtDateTime(inTime)} — ${data.note}`, link: `/movement/${m._id}` });
    await notifyPermission("movement.manage", { type: "movement", title: `Open movement resolved: ${m.movementNo}`, body: `${actor.name}: ${data.note}`, link: `/movement/${m._id}` }, [actor._id]);
    return null;
  }, "Movement resolved");
}
