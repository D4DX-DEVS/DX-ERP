"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { isStaff } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Project, Task, TimesheetEntry, User } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { inList, jsonPush } from "@/lib/sql";
import { fmtDate, formatDuration, todayKey, weekStart } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { historyEntry, loggableProjectIds, taskFilter } from "@/lib/work-access";
import { parseDuration } from "./duration";
import { weekRange } from "./week";

const entrySchema = z.object({
  date: zs.date("Date"),
  project: zs.optId(),
  task: zs.optId(),
  duration: zs.text("Duration", 20),
  description: zs.text("Description", 2000),
  billable: zs.bool(),
});

const MAX_DAY_MINUTES = 24 * 60;

/** Creates (no `id`) or edits a timesheet entry. Only draft and rejected entries are editable. */
export async function saveEntry(id: string | undefined, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isStaff(user)) throw new ActionError("Timesheets are recorded by staff members.");
    const data = parse(entrySchema, input);
    const today = todayKey();
    if (data.date > today) throw new ActionError("You can't log time for a future date.", { date: "Choose today or an earlier date" });
    const minutes = parseDuration(data.duration);
    if (minutes === null) throw new ActionError("Enter a duration like 1.5 or 1:30 (up to 24 hours).", { duration: "Use hours (1.5) or h:mm (1:30)" });

    let projectId = data.project;
    if (data.task) {
      const visible = await taskFilter(user);
      const [task] = await db().select({ project: Task.project }).from(Task).where(and(eq(Task._id, data.task), visible)).limit(1);
      if (!task) throw new ActionError("That task isn't available to you.", { task: "Choose one of your tasks" });
      if (projectId && (task.project ?? undefined) !== projectId) throw new ActionError("That task belongs to a different project.", { task: "Not part of this project" });
      projectId = task.project ?? undefined;
    }
    if (projectId) {
      const allowed = (await loggableProjectIds(user)).some((p) => p === projectId);
      if (!allowed) throw new ActionError("You can't log time on that project.", { project: "Choose one of your projects" });
    }

    let entry: { _id: string; status: string } | undefined;
    if (id) {
      if (!isObjectId(id)) throw new ActionError("Entry not found.");
      [entry] = await db().select({ _id: TimesheetEntry._id, status: TimesheetEntry.status }).from(TimesheetEntry).where(and(eq(TimesheetEntry._id, id), eq(TimesheetEntry.user, user._id))).limit(1);
      if (!entry) throw new ActionError("Entry not found.");
      if (entry.status === "submitted") throw new ActionError("This entry has been submitted. Ask your reviewer to reject it if it needs changes.");
      if (entry.status === "approved") throw new ActionError("Approved entries are locked. A reviewer can reopen them for correction.");
    }

    const sameDay = await db()
      .select({ minutes: sql<number>`coalesce(sum(${TimesheetEntry.minutes}), 0)`.mapWith(Number) })
      .from(TimesheetEntry)
      .where(and(eq(TimesheetEntry.user, user._id), eq(TimesheetEntry.date, data.date), entry ? ne(TimesheetEntry._id, entry._id) : undefined));
    const total = (sameDay[0]?.minutes ?? 0) + minutes;
    if (total > MAX_DAY_MINUTES) {
      throw new ActionError(`That would make ${formatDuration(total)} on ${fmtDate(data.date, "d MMM")}. A day has only 24 hours.`, { duration: "Exceeds 24 hours for the day" });
    }

    const week = weekStart(data.date);
    if (entry) {
      const wasRejected = entry.status === "rejected";
      await db()
        .update(TimesheetEntry)
        .set({
          date: data.date,
          weekStart: week,
          project: projectId ?? null,
          task: data.task ?? null,
          minutes,
          description: data.description,
          billable: data.billable,
          history: jsonPush(TimesheetEntry.history, historyEntry(user, wasRejected ? "Edited after rejection" : "Edited", { note: `${formatDuration(minutes)} on ${fmtDate(data.date, "d MMM")}` })),
          ...(wasRejected ? { status: "draft" as const } : {}),
        })
        .where(eq(TimesheetEntry._id, entry._id));
      return { id: entry._id };
    }

    const [created] = await db()
      .insert(TimesheetEntry)
      .values({
        user: user._id,
        date: data.date,
        weekStart: week,
        project: projectId,
        task: data.task,
        minutes,
        description: data.description,
        billable: data.billable,
        status: "draft",
        history: [historyEntry(user, "Created", { note: formatDuration(minutes) })],
      })
      .returning({ id: TimesheetEntry._id });
    return { id: created.id };
  }, "Time saved");
}

export async function deleteEntry(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Entry not found.");
    const [entry] = await db().select({ _id: TimesheetEntry._id, status: TimesheetEntry.status }).from(TimesheetEntry).where(and(eq(TimesheetEntry._id, id), eq(TimesheetEntry.user, user._id))).limit(1);
    if (!entry) throw new ActionError("Entry not found.");
    if (entry.status !== "draft" && entry.status !== "rejected") throw new ActionError("Only draft or rejected entries can be deleted.");
    await db().delete(TimesheetEntry).where(eq(TimesheetEntry._id, entry._id));
    return null;
  }, "Entry deleted");
}

/** Submits every draft / rejected entry of the week for review by the project manager (fallback: reporting manager). */
export async function submitWeek(week: string): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isStaff(user)) throw new ActionError("Timesheets are recorded by staff members.");
    const monday = parse(zs.date("Week"), week);
    if (weekStart(monday) !== monday) throw new ActionError("Invalid week.");
    const entries = await db()
      .select({ _id: TimesheetEntry._id, project: TimesheetEntry.project, minutes: TimesheetEntry.minutes })
      .from(TimesheetEntry)
      .where(and(eq(TimesheetEntry.user, user._id), eq(TimesheetEntry.weekStart, monday), inList(TimesheetEntry.status, ["draft", "rejected"])));
    if (entries.length === 0) throw new ActionError("There are no draft entries to submit for this week.");

    const projectIds = [...new Set(entries.map((e) => e.project).filter(Boolean) as string[])];
    const projects = projectIds.length ? await db().select({ _id: Project._id, manager: Project.manager }).from(Project).where(inList(Project._id, projectIds)) : [];
    const managerOf = new Map(projects.map((p) => [p._id, p.manager ?? undefined]));
    const fallback = user.reportingManagerId;
    const reviewerOf = (projectId?: string | null): string | undefined => {
      const pm = projectId ? managerOf.get(projectId) : undefined;
      if (pm && pm !== user.id) return pm;
      return fallback && fallback !== user.id ? fallback : undefined;
    };
    const reviewerIds = [...new Set(entries.map((e) => reviewerOf(e.project)).filter(Boolean) as string[])];
    const reviewers = reviewerIds.length ? await db().select({ _id: User._id, name: User.name }).from(User).where(inList(User._id, reviewerIds)) : [];
    const reviewerName = new Map(reviewers.map((r) => [r._id, r.name]));

    const now = new Date();
    const perReviewer = new Map<string, number>();
    let unassigned = 0;
    // Entries with the same reviewer get the same update, so they are written together.
    const byReviewer = new Map<string | undefined, string[]>();
    for (const e of entries) {
      const reviewer = reviewerOf(e.project);
      byReviewer.set(reviewer, [...(byReviewer.get(reviewer) ?? []), e._id]);
      if (reviewer) perReviewer.set(reviewer, (perReviewer.get(reviewer) ?? 0) + e.minutes);
      else unassigned += e.minutes;
    }
    for (const [reviewer, entryIds] of byReviewer) {
      await db()
        .update(TimesheetEntry)
        .set({
          status: "submitted",
          submittedAt: now,
          reviewer: reviewer ?? null,
          reviewerName: (reviewer ? reviewerName.get(reviewer) : undefined) ?? null,
          reviewedAt: null,
          history: jsonPush(TimesheetEntry.history, historyEntry(user, "Submitted for review", { note: reviewer ? `Reviewer: ${reviewerName.get(reviewer) ?? "—"}` : "No reviewer assigned" })),
        })
        .where(inList(TimesheetEntry._id, entryIds));
    }

    await audit(user, { action: "submit", entity: "timesheet", ref: monday, summary: `${user.name} submitted ${entries.length} timesheet ${entries.length === 1 ? "entry" : "entries"} for the week of ${weekRange(monday)}` });
    for (const [reviewer, minutes] of perReviewer) {
      await notify(
        [reviewer],
        { type: "timesheet", title: `Timesheet to review: ${user.name}`, body: `${weekRange(monday)} · ${formatDuration(minutes)}`, link: "/timesheets/approvals", actionable: true },
        [user._id],
      );
    }
    if (unassigned > 0) {
      await notifyPermission(
        "timesheets.approve",
        { type: "timesheet", title: `Timesheet to review: ${user.name}`, body: `${weekRange(monday)} · ${formatDuration(unassigned)} · no reviewer assigned`, link: "/timesheets/approvals", actionable: true },
        [user._id],
      );
    }
    return { count: entries.length };
  }, "Week submitted for review");
}
