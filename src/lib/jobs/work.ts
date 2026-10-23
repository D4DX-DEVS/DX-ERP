import "server-only";
import { connectDB } from "@/lib/db";
import { Notification, Project, Task, TimesheetEntry, type ObjectId } from "@/lib/models";
import { notify, usersWithPermission, type NotifyInput } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addDays, fmtDate, formatDuration, hmToMinutes, timeOf, todayKey, weekday, weekStart } from "@/lib/time";
import { keysInCategories, PROJECT_CLOSED_CATEGORIES, TASK_CLOSED_CATEGORIES } from "@/lib/work-access";
import { weekRange } from "@/app/(app)/timesheets/week";
import type { Job } from "./registry";

type Recipient = string | ObjectId | null | undefined;

/**
 * Sends a reminder once per (person, dedupeKey). `notify` itself de-duplicates the stored record,
 * but filtering first also stops repeat emails when a job runs again.
 */
async function notifyOnce(recipients: Recipient[], input: NotifyInput & { dedupeKey: string }): Promise<number> {
  const ids = [...new Set(recipients.filter(Boolean).map((r) => String(r)))];
  if (ids.length === 0) return 0;
  const existing = await Notification.find({ dedupeKey: input.dedupeKey, user: { $in: ids } }, { user: 1 }).lean();
  const seen = new Set(existing.map((e) => e.user.toString()));
  const fresh = ids.filter((id) => !seen.has(id));
  if (fresh.length === 0) return 0;
  await notify(fresh, input);
  return fresh.length;
}

const BATCH = 500;

/** Open tasks due tomorrow → assignees. */
async function taskDueTomorrow(): Promise<string> {
  await connectDB();
  const settings = await getSettings();
  const closed = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const tomorrow = addDays(todayKey(), 1);
  const tasks = await Task.find({ dueDate: tomorrow, status: { $nin: closed }, "assignees.0": { $exists: true } }, { taskNo: 1, title: 1, assignees: 1, dueDate: 1 }).limit(BATCH).lean();
  let sent = 0;
  for (const t of tasks) {
    sent += await notifyOnce(t.assignees, {
      type: "task",
      title: `Due tomorrow: ${t.title}`,
      body: `${t.taskNo} · due ${fmtDate(tomorrow, "EEE d MMM")}`,
      link: `/tasks/${t._id}`,
      dedupeKey: `task-due-${t._id}-${tomorrow}`,
    });
  }
  return `${tasks.length} tasks due tomorrow, ${sent} reminders sent`;
}

/** Overdue open tasks → assignees and the project manager, once per day. */
async function taskOverdue(): Promise<string> {
  await connectDB();
  const settings = await getSettings();
  const closed = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const today = todayKey();
  const tasks = await Task.find({ dueDate: { $lt: today }, status: { $nin: closed } }, { taskNo: 1, title: 1, assignees: 1, project: 1, dueDate: 1 }).sort({ dueDate: 1 }).limit(BATCH).lean();
  const projectIds = [...new Set(tasks.map((t) => t.project?.toString()).filter(Boolean) as string[])];
  const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { manager: 1 }).lean() : [];
  const managerOf = new Map(projects.map((p) => [p._id.toString(), p.manager]));
  let sent = 0;
  for (const t of tasks) {
    const manager = t.project ? managerOf.get(t.project.toString()) : undefined;
    sent += await notifyOnce([...t.assignees, manager], {
      type: "task",
      title: `Overdue: ${t.title}`,
      body: `${t.taskNo} was due ${fmtDate(t.dueDate, "EEE d MMM")}`,
      link: `/tasks/${t._id}`,
      priority: "high",
      dedupeKey: `task-overdue-${t._id}-${today}`,
    });
  }
  return `${tasks.length} overdue tasks, ${sent} reminders sent`;
}

/** Milestones due within 3 days → PM; overdue undelivered milestones → status "delayed" + PM. */
async function milestones(): Promise<string> {
  await connectDB();
  const settings = await getSettings();
  const closed = keysInCategories(settings.projectStatuses, PROJECT_CLOSED_CATEGORIES);
  const today = todayKey();
  const horizon = addDays(today, 3);
  const projects = await Project.find(
    { status: { $nin: closed }, milestones: { $elemMatch: { status: { $nin: ["delivered", "approved"] }, dueDate: { $lte: horizon } } } },
    { projectNo: 1, title: 1, manager: 1, milestones: 1 },
  )
    .limit(BATCH)
    .lean();
  const fallback = projects.some((p) => !p.manager) ? await usersWithPermission("projects.manage") : [];
  let soon = 0;
  let delayed = 0;
  for (const p of projects) {
    const recipients: Recipient[] = p.manager ? [p.manager] : fallback;
    for (const m of p.milestones) {
      if (m.status === "delivered" || m.status === "approved" || !m.dueDate || m.dueDate > horizon) continue;
      const link = `/projects/${p._id}?tab=milestones`;
      if (m.dueDate < today) {
        if (m.status !== "delayed") {
          const res = await Project.updateOne(
            { _id: p._id, milestones: { $elemMatch: { _id: m._id, status: { $nin: ["delivered", "approved"] } } } },
            {
              $set: { "milestones.$.status": "delayed" },
              $push: { history: { action: `Milestone “${m.title}” marked delayed`, byName: "System", at: new Date(), from: m.status, to: "delayed", note: `Due ${m.dueDate}` } },
            },
          );
          if (res.modifiedCount > 0) delayed += 1;
        }
        await notifyOnce(recipients, {
          type: "project",
          title: `Milestone delayed: ${m.title}`,
          body: `${p.projectNo} · ${p.title} · was due ${fmtDate(m.dueDate, "EEE d MMM")}`,
          link,
          priority: "high",
          dedupeKey: `ms-overdue-${m._id}`,
        });
      } else {
        soon += await notifyOnce(recipients, {
          type: "project",
          title: `Milestone due soon: ${m.title}`,
          body: `${p.projectNo} · ${p.title} · due ${fmtDate(m.dueDate, "EEE d MMM")}`,
          link,
          dedupeKey: `ms-due-${m._id}`,
        });
      }
    }
  }
  return `${delayed} milestones marked delayed, ${soon} due-soon reminders sent`;
}

/** Friday afternoon: people with draft timesheet entries this week are reminded to submit. */
async function timesheetFriday(): Promise<string> {
  const today = todayKey();
  if (weekday(today) !== 5 || hmToMinutes(timeOf(new Date())) < 15 * 60) return "not Friday afternoon";
  await connectDB();
  const week = weekStart(today);
  const users = (await TimesheetEntry.distinct("user", { weekStart: week, status: "draft" })) as ObjectId[];
  const sent = await notifyOnce(users, {
    type: "timesheet",
    title: "Submit your timesheet for this week",
    body: `You have draft entries for ${weekRange(week)}. Submit them for review before the weekend.`,
    link: `/timesheets?week=${week}`,
    dedupeKey: `ts-friday-${week}`,
  });
  return `${users.length} people with drafts, ${sent} reminders sent`;
}

/** Submitted timesheet entries waiting more than 2 days → their reviewer (or timesheet approvers when none is set). */
async function timesheetWaiting(): Promise<string> {
  await connectDB();
  const cutoff = new Date(Date.now() - 2 * 86_400_000);
  const waiting = await TimesheetEntry.find({ status: "submitted", submittedAt: { $lt: cutoff } }, { reviewer: 1, user: 1, minutes: 1 }).limit(5000).lean();
  if (waiting.length === 0) return "none waiting";
  const today = todayKey();
  const byReviewer = new Map<string, { people: Set<string>; minutes: number; count: number }>();
  const unassigned = { people: new Set<string>(), minutes: 0, count: 0 };
  for (const e of waiting) {
    const bucket = e.reviewer ? (byReviewer.get(e.reviewer.toString()) ?? { people: new Set<string>(), minutes: 0, count: 0 }) : unassigned;
    bucket.people.add(e.user.toString());
    bucket.minutes += e.minutes;
    bucket.count += 1;
    if (e.reviewer) byReviewer.set(e.reviewer.toString(), bucket);
  }
  const text = (b: { people: Set<string>; minutes: number; count: number }) => `${b.count} ${b.count === 1 ? "entry" : "entries"} from ${b.people.size} ${b.people.size === 1 ? "person" : "people"} · ${formatDuration(b.minutes)} waiting more than 2 days`;
  let sent = 0;
  for (const [reviewer, bucket] of byReviewer) {
    sent += await notifyOnce([reviewer], { type: "timesheet", title: "Timesheets are waiting for your review", body: text(bucket), link: "/timesheets/approvals", actionable: true, dedupeKey: `ts-waiting-${today}` });
  }
  if (unassigned.count > 0) {
    sent += await notifyOnce(await usersWithPermission("timesheets.approve"), { type: "timesheet", title: "Timesheets are waiting for review", body: text(unassigned), link: "/timesheets/approvals", actionable: true, dedupeKey: `ts-waiting-${today}` });
  }
  return `${waiting.length} entries waiting, ${sent} reminders sent`;
}

export const workJobs: Job[] = [
  { name: "work-task-due-tomorrow", intervalMinutes: 60, run: taskDueTomorrow },
  { name: "work-task-overdue", intervalMinutes: 60, run: taskOverdue },
  { name: "work-milestones", intervalMinutes: 60, run: milestones },
  { name: "work-timesheet-friday", intervalMinutes: 30, run: timesheetFriday },
  { name: "work-timesheet-waiting", intervalMinutes: 120, run: timesheetWaiting },
];
