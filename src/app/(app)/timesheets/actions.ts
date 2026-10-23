"use server";

import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { isStaff } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { Project, Task, TimesheetEntry, User } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
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
      const task = await Task.findOne({ $and: [{ _id: data.task }, visible] }, { project: 1 }).lean();
      if (!task) throw new ActionError("That task isn't available to you.", { task: "Choose one of your tasks" });
      if (projectId && task.project?.toString() !== projectId) throw new ActionError("That task belongs to a different project.", { task: "Not part of this project" });
      projectId = task.project?.toString();
    }
    if (projectId) {
      const allowed = (await loggableProjectIds(user)).some((p) => p.toString() === projectId);
      if (!allowed) throw new ActionError("You can't log time on that project.", { project: "Choose one of your projects" });
    }

    let entry = null;
    if (id) {
      if (!isObjectId(id)) throw new ActionError("Entry not found.");
      entry = await TimesheetEntry.findOne({ _id: id, user: user._id });
      if (!entry) throw new ActionError("Entry not found.");
      if (entry.status === "submitted") throw new ActionError("This entry has been submitted. Ask your reviewer to reject it if it needs changes.");
      if (entry.status === "approved") throw new ActionError("Approved entries are locked. A reviewer can reopen them for correction.");
    }

    const sameDay = await TimesheetEntry.aggregate<{ _id: null; minutes: number }>([
      { $match: { user: user._id, date: data.date, ...(entry ? { _id: { $ne: entry._id } } : {}) } },
      { $group: { _id: null, minutes: { $sum: "$minutes" } } },
    ]);
    const total = (sameDay[0]?.minutes ?? 0) + minutes;
    if (total > MAX_DAY_MINUTES) {
      throw new ActionError(`That would make ${formatDuration(total)} on ${fmtDate(data.date, "d MMM")}. A day has only 24 hours.`, { duration: "Exceeds 24 hours for the day" });
    }

    const week = weekStart(data.date);
    if (entry) {
      const wasRejected = entry.status === "rejected";
      entry.date = data.date;
      entry.weekStart = week;
      entry.set("project", projectId);
      entry.set("task", data.task);
      entry.minutes = minutes;
      entry.description = data.description;
      entry.billable = data.billable;
      entry.history.push(historyEntry(user, wasRejected ? "Edited after rejection" : "Edited", { note: `${formatDuration(minutes)} on ${fmtDate(data.date, "d MMM")}` }));
      if (wasRejected) entry.status = "draft";
      await entry.save();
      return { id: entry._id.toString() };
    }

    const created = await TimesheetEntry.create({
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
    });
    return { id: created._id.toString() };
  }, "Time saved");
}

export async function deleteEntry(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(id)) throw new ActionError("Entry not found.");
    const entry = await TimesheetEntry.findOne({ _id: id, user: user._id });
    if (!entry) throw new ActionError("Entry not found.");
    if (entry.status !== "draft" && entry.status !== "rejected") throw new ActionError("Only draft or rejected entries can be deleted.");
    await entry.deleteOne();
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
    const entries = await TimesheetEntry.find({ user: user._id, weekStart: monday, status: { $in: ["draft", "rejected"] } });
    if (entries.length === 0) throw new ActionError("There are no draft entries to submit for this week.");

    const projectIds = [...new Set(entries.map((e) => e.project?.toString()).filter(Boolean) as string[])];
    const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { manager: 1 }).lean() : [];
    const managerOf = new Map(projects.map((p) => [p._id.toString(), p.manager?.toString()]));
    const fallback = user.reportingManagerId;
    const reviewerOf = (projectId?: string): string | undefined => {
      const pm = projectId ? managerOf.get(projectId) : undefined;
      if (pm && pm !== user.id) return pm;
      return fallback && fallback !== user.id ? fallback : undefined;
    };
    const reviewerIds = [...new Set(entries.map((e) => reviewerOf(e.project?.toString())).filter(Boolean) as string[])];
    const reviewers = reviewerIds.length ? await User.find({ _id: { $in: reviewerIds } }, { name: 1 }).lean() : [];
    const reviewerName = new Map(reviewers.map((r) => [r._id.toString(), r.name]));

    const now = new Date();
    const perReviewer = new Map<string, number>();
    let unassigned = 0;
    for (const e of entries) {
      const reviewer = reviewerOf(e.project?.toString());
      e.status = "submitted";
      e.submittedAt = now;
      e.set("reviewer", reviewer);
      e.reviewerName = reviewer ? reviewerName.get(reviewer) : undefined;
      e.reviewedAt = undefined;
      e.history.push(historyEntry(user, "Submitted for review", { note: reviewer ? `Reviewer: ${reviewerName.get(reviewer) ?? "—"}` : "No reviewer assigned" }));
      await e.save();
      if (reviewer) perReviewer.set(reviewer, (perReviewer.get(reviewer) ?? 0) + e.minutes);
      else unassigned += e.minutes;
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
