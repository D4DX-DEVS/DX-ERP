"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { TimesheetEntry } from "@/lib/models";
import { notify, notifyMany } from "@/lib/notify";
import { inList, jsonPush } from "@/lib/sql";
import { formatDuration } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { historyEntry, peopleMap, timesheetScope } from "@/lib/work-access";
import { weekRange } from "../week";

const idsSchema = z.array(zs.id("Entry")).min(1, "Select at least one entry").max(500);

/** Loads submitted entries and verifies the reviewer may act on every one of them (never their own). */
async function loadReviewable(ids: string[]) {
  const user = await actionUser();
  const entryIds = parse(idsSchema, ids);
  const scope = await timesheetScope(user, "approve");
  if (!scope.hasAccess) throw new ActionError("You don't have permission to review timesheets.");
  const entries = await db()
    .select({ _id: TimesheetEntry._id, user: TimesheetEntry.user, project: TimesheetEntry.project, reviewer: TimesheetEntry.reviewer, weekStart: TimesheetEntry.weekStart, minutes: TimesheetEntry.minutes })
    .from(TimesheetEntry)
    .where(and(inList(TimesheetEntry._id, entryIds), eq(TimesheetEntry.status, "submitted")));
  if (entries.length === 0) throw new ActionError("These entries are no longer waiting for review.");
  if (entries.some((e) => e.user === user._id)) throw new ActionError("You can't review your own time.");
  const blocked = entries.filter((e) => !scope.includes(e));
  if (blocked.length) throw new ActionError(`You can't review ${blocked.length} of these entries.`);
  return { user, entries };
}

/** Sends one notification per person and week to say how their entries were decided. */
async function notifyOwners(entries: { user: string; weekStart: string; minutes: number }[], title: (week: string) => string, body: (minutes: number, count: number) => string, actorId: string) {
  const groups = new Map<string, { owner: string; week: string; minutes: number; count: number }>();
  for (const e of entries) {
    const key = `${e.user}|${e.weekStart}`;
    const g = groups.get(key) ?? { owner: e.user, week: e.weekStart, minutes: 0, count: 0 };
    g.minutes += e.minutes;
    g.count += 1;
    groups.set(key, g);
  }
  await notifyMany(
    [...groups.values()].map((g) => ({
      recipients: [g.owner],
      input: { type: "timesheet", title: title(g.week), body: body(g.minutes, g.count), link: `/timesheets?week=${g.week}` },
      exclude: [actorId],
    })),
  );
}

export async function approveEntries(ids: string[]): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const { user, entries } = await loadReviewable(ids);
    const now = new Date();
    await db()
      .update(TimesheetEntry)
      .set({ status: "approved", reviewedAt: now, reviewer: user._id, reviewerName: user.name, reviewNote: null, history: jsonPush(TimesheetEntry.history, historyEntry(user, "Approved")) })
      .where(and(inList(TimesheetEntry._id, entries.map((e) => e._id)), eq(TimesheetEntry.status, "submitted")));
    const names = await peopleMap(entries.map((e) => e.user));
    const owners = [...new Set(entries.map((e) => names.get(e.user)?.name ?? "Unknown"))];
    await audit(user, { action: "approve", entity: "timesheet", summary: `Approved ${entries.length} timesheet ${entries.length === 1 ? "entry" : "entries"} (${formatDuration(entries.reduce((s, e) => s + e.minutes, 0))}) for ${owners.join(", ")}` });
    await notifyOwners(entries, (w) => `Timesheet approved: ${weekRange(w)}`, (m, c) => `${c} ${c === 1 ? "entry" : "entries"} · ${formatDuration(m)} approved by ${user.name}`, user.id);
    return { count: entries.length };
  }, "Approved");
}

export async function rejectEntries(ids: string[], reason: string): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const why = parse(zs.text("Reason", 1000), reason);
    const { user, entries } = await loadReviewable(ids);
    const now = new Date();
    await db()
      .update(TimesheetEntry)
      .set({ status: "rejected", reviewedAt: now, reviewer: user._id, reviewerName: user.name, reviewNote: why, history: jsonPush(TimesheetEntry.history, historyEntry(user, "Rejected", { note: why })) })
      .where(and(inList(TimesheetEntry._id, entries.map((e) => e._id)), eq(TimesheetEntry.status, "submitted")));
    const names = await peopleMap(entries.map((e) => e.user));
    const owners = [...new Set(entries.map((e) => names.get(e.user)?.name ?? "Unknown"))];
    await audit(user, { action: "reject", entity: "timesheet", summary: `Rejected ${entries.length} timesheet ${entries.length === 1 ? "entry" : "entries"} for ${owners.join(", ")}: ${why}` });
    await notifyOwners(entries, (w) => `Timesheet needs changes: ${weekRange(w)}`, () => why.slice(0, 200), user.id);
    return { count: entries.length };
  }, "Rejected");
}

/** Reopens an approved entry for correction; the reason is kept in the entry's correction history. */
export async function reopenEntry(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Entry not found.");
    const why = parse(zs.text("Reason", 1000), reason);
    const scope = await timesheetScope(user, "approve");
    const [entry] = await db()
      .select({ _id: TimesheetEntry._id, user: TimesheetEntry.user, project: TimesheetEntry.project, reviewer: TimesheetEntry.reviewer, status: TimesheetEntry.status, minutes: TimesheetEntry.minutes, date: TimesheetEntry.date, weekStart: TimesheetEntry.weekStart })
      .from(TimesheetEntry)
      .where(eq(TimesheetEntry._id, id))
      .limit(1);
    if (!entry) throw new ActionError("Entry not found.");
    if (entry.status !== "approved") throw new ActionError("Only approved entries can be reopened.");
    if (!scope.includes(entry)) throw new ActionError("You can't reopen this entry.");
    await db()
      .update(TimesheetEntry)
      .set({
        status: "draft",
        reviewedAt: null,
        submittedAt: null,
        history: jsonPush(TimesheetEntry.history, historyEntry(user, "Reopened for correction", { from: "Approved", to: "Draft", note: why })),
      })
      .where(eq(TimesheetEntry._id, entry._id));
    await audit(user, { action: "correct", entity: "timesheet", entityId: entry._id, summary: `Reopened an approved timesheet entry (${formatDuration(entry.minutes)} on ${entry.date}): ${why}` });
    await notify([entry.user], { type: "timesheet", title: "A timesheet entry was reopened", body: `${entry.date} · ${why}`, link: `/timesheets?week=${entry.weekStart}`, actionable: true }, [user._id]);
    return null;
  }, "Entry reopened");
}
