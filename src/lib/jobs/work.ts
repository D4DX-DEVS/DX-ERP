import "server-only";
import { and, asc, count, eq, gt, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db } from "@/lib/db";
import { newId, Project, Task, TimesheetEntry, type Id, type Milestone } from "@/lib/models";
import { usersWithPermission } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { inList, jsonLength, jsonPush, notInList } from "@/lib/sql";
import { addDays, fmtDate, formatDuration, hmToMinutes, timeOf, todayKey, weekday, weekStart } from "@/lib/time";
import { keysInCategories, PROJECT_CLOSED_CATEGORIES, TASK_CLOSED_CATEGORIES } from "@/lib/work-access";
import { weekRange } from "@/app/(app)/timesheets/week";
import { notifyBatch, runGuardedUpdates, type BatchedNotification } from "./batch";
import type { Job } from "./registry";

type Recipient = Id | null | undefined;

const BATCH = 500;

/** Open tasks due tomorrow → assignees. */
async function taskDueTomorrow(): Promise<string> {
  const settings = await getSettings();
  const closed = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const tomorrow = addDays(todayKey(), 1);
  const tasks = await db()
    .select({ id: Task._id, taskNo: Task.taskNo, title: Task.title, assignees: Task.assignees })
    .from(Task)
    .where(and(eq(Task.dueDate, tomorrow), notInList(Task.status, closed), gt(jsonLength(Task.assignees), 0)))
    .limit(BATCH);
  const sent = await notifyBatch(
    tasks.map((t) => ({
      recipients: t.assignees,
      input: {
        type: "task",
        title: `Due tomorrow: ${t.title}`,
        body: `${t.taskNo} · due ${fmtDate(tomorrow, "EEE d MMM")}`,
        link: `/tasks/${t.id}`,
        dedupeKey: `task-due-${t.id}-${tomorrow}`,
      },
    })),
  );
  return `${tasks.length} tasks due tomorrow, ${sent} reminders sent`;
}

/** Overdue open tasks → assignees and the project manager, once per day. */
async function taskOverdue(): Promise<string> {
  const settings = await getSettings();
  const closed = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const today = todayKey();
  const tasks = await db()
    .select({ id: Task._id, taskNo: Task.taskNo, title: Task.title, assignees: Task.assignees, project: Task.project, dueDate: Task.dueDate })
    .from(Task)
    .where(and(lt(Task.dueDate, today), notInList(Task.status, closed)))
    .orderBy(asc(Task.dueDate))
    .limit(BATCH);
  const projectIds = [...new Set(tasks.map((t) => t.project).filter(Boolean) as string[])];
  const projects = projectIds.length ? await db().select({ id: Project._id, manager: Project.manager }).from(Project).where(inList(Project._id, projectIds)) : [];
  const managerOf = new Map(projects.map((p) => [p.id, p.manager]));
  const sent = await notifyBatch(
    tasks.map((t) => {
      const manager = t.project ? managerOf.get(t.project) : undefined;
      return {
        recipients: [...t.assignees, manager],
        input: {
          type: "task",
          title: `Overdue: ${t.title}`,
          body: `${t.taskNo} was due ${fmtDate(t.dueDate, "EEE d MMM")}`,
          link: `/tasks/${t.id}`,
          priority: "high" as const,
          dedupeKey: `task-overdue-${t.id}-${today}`,
        },
      };
    }),
  );
  return `${tasks.length} overdue tasks, ${sent} reminders sent`;
}

/** Milestones due within 3 days → PM; overdue undelivered milestones → status "delayed" + PM. */
async function milestones(): Promise<string> {
  const settings = await getSettings();
  const closed = keysInCategories(settings.projectStatuses, PROJECT_CLOSED_CATEGORIES);
  const today = todayKey();
  const horizon = addDays(today, 3);
  // A project qualifies when one of its milestones is undelivered (not delivered / approved) and due within the horizon.
  const openMilestoneDue = sql`exists (select 1 from json_each(${Project.milestones}) where ${notInList(sql`json_extract(value, '$.status')`, ["delivered", "approved"])} and json_extract(value, '$.dueDate') <= ${horizon})`;
  const projects = await db()
    .select({ id: Project._id, projectNo: Project.projectNo, title: Project.title, manager: Project.manager, milestones: Project.milestones, updatedAt: Project.updatedAt })
    .from(Project)
    .where(and(notInList(Project.status, closed), openMilestoneDue))
    .limit(BATCH);
  const fallback = projects.some((p) => !p.manager) ? await usersWithPermission("projects.manage") : [];
  const overdueItems: BatchedNotification[] = [];
  const soonItems: BatchedNotification[] = [];
  const updates: BatchItem<"sqlite">[] = [];
  const delayedBy = new Map<string, number>();
  for (const p of projects) {
    const recipients: Recipient[] = p.manager ? [p.manager] : fallback;
    const toDelay = new Map<Id, Milestone>();
    for (const m of p.milestones) {
      if (m.status === "delivered" || m.status === "approved" || !m.dueDate || m.dueDate > horizon) continue;
      const link = `/projects/${p.id}?tab=milestones`;
      if (m.dueDate < today) {
        if (m.status !== "delayed") toDelay.set(m._id, m);
        overdueItems.push({
          recipients,
          input: {
            type: "project",
            title: `Milestone delayed: ${m.title}`,
            body: `${p.projectNo} · ${p.title} · was due ${fmtDate(m.dueDate, "EEE d MMM")}`,
            link,
            priority: "high",
            dedupeKey: `ms-overdue-${m._id}`,
          },
        });
      } else {
        soonItems.push({
          recipients,
          input: {
            type: "project",
            title: `Milestone due soon: ${m.title}`,
            body: `${p.projectNo} · ${p.title} · due ${fmtDate(m.dueDate, "EEE d MMM")}`,
            link,
            dedupeKey: `ms-due-${m._id}`,
          },
        });
      }
    }
    if (toDelay.size === 0) continue;
    // One write per project. `updatedAt` is the guard: if anyone edited the project since we read it (e.g. delivered a
    // milestone), nothing is written and the next run looks again.
    delayedBy.set(p.id, toDelay.size);
    updates.push(
      db()
        .update(Project)
        .set({
          milestones: p.milestones.map((m) => (toDelay.has(m._id) ? { ...m, status: "delayed" as const } : m)),
          history: jsonPush(
            Project.history,
            ...[...toDelay.values()].map((m) => ({ _id: newId(), action: `Milestone “${m.title}” marked delayed`, byName: "System", at: new Date(), from: m.status, to: "delayed", note: `Due ${m.dueDate}` })),
          ),
        })
        .where(and(eq(Project._id, p.id), eq(Project.updatedAt, p.updatedAt)))
        .returning({ id: Project._id }),
    );
  }
  const written = await runGuardedUpdates(updates);
  const delayed = [...written].reduce((n, id) => n + (delayedBy.get(id) ?? 0), 0);
  await notifyBatch(overdueItems);
  const soon = await notifyBatch(soonItems);
  return `${delayed} milestones marked delayed, ${soon} due-soon reminders sent`;
}

/** Friday afternoon: people with draft timesheet entries this week are reminded to submit. */
async function timesheetFriday(): Promise<string> {
  const today = todayKey();
  if (weekday(today) !== 5 || hmToMinutes(timeOf(new Date())) < 15 * 60) return "not Friday afternoon";
  const week = weekStart(today);
  const drafts = await db()
    .selectDistinct({ user: TimesheetEntry.user })
    .from(TimesheetEntry)
    .where(and(eq(TimesheetEntry.weekStart, week), eq(TimesheetEntry.status, "draft")));
  const users = drafts.map((d) => d.user);
  const sent = await notifyBatch([
    {
      recipients: users,
      input: {
        type: "timesheet",
        title: "Submit your timesheet for this week",
        body: `You have draft entries for ${weekRange(week)}. Submit them for review before the weekend.`,
        link: `/timesheets?week=${week}`,
        dedupeKey: `ts-friday-${week}`,
      },
    },
  ]);
  return `${users.length} people with drafts, ${sent} reminders sent`;
}

/** Submitted timesheet entries waiting more than 2 days → their reviewer (or timesheet approvers when none is set). */
async function timesheetWaiting(): Promise<string> {
  const cutoff = new Date(Date.now() - 2 * 86_400_000);
  // Entries per reviewer (no reviewer = unassigned): how many, from how many people, and for how long in total.
  const buckets = await db()
    .select({
      reviewer: TimesheetEntry.reviewer,
      count: count(),
      people: sql<number>`count(distinct ${TimesheetEntry.user})`.mapWith(Number),
      minutes: sql<number>`coalesce(sum(${TimesheetEntry.minutes}), 0)`.mapWith(Number),
    })
    .from(TimesheetEntry)
    .where(and(eq(TimesheetEntry.status, "submitted"), lt(TimesheetEntry.submittedAt, cutoff)))
    .groupBy(TimesheetEntry.reviewer);
  const waiting = buckets.reduce((n, b) => n + b.count, 0);
  if (waiting === 0) return "none waiting";
  const today = todayKey();
  const text = (b: { people: number; minutes: number; count: number }) => `${b.count} ${b.count === 1 ? "entry" : "entries"} from ${b.people} ${b.people === 1 ? "person" : "people"} · ${formatDuration(b.minutes)} waiting more than 2 days`;
  const items: BatchedNotification[] = [];
  let unassigned: (typeof buckets)[number] | undefined;
  for (const bucket of buckets) {
    if (bucket.reviewer) {
      items.push({ recipients: [bucket.reviewer], input: { type: "timesheet", title: "Timesheets are waiting for your review", body: text(bucket), link: "/timesheets/approvals", actionable: true, dedupeKey: `ts-waiting-${today}` } });
    } else unassigned = bucket;
  }
  if (unassigned && unassigned.count > 0) {
    items.push({ recipients: await usersWithPermission("timesheets.approve"), input: { type: "timesheet", title: "Timesheets are waiting for review", body: text(unassigned), link: "/timesheets/approvals", actionable: true, dedupeKey: `ts-waiting-${today}` } });
  }
  const sent = await notifyBatch(items);
  return `${waiting} entries waiting, ${sent} reminders sent`;
}

export const workJobs: Job[] = [
  { name: "work-task-due-tomorrow", intervalMinutes: 60, run: taskDueTomorrow },
  { name: "work-task-overdue", intervalMinutes: 60, run: taskOverdue },
  { name: "work-milestones", intervalMinutes: 60, run: milestones },
  { name: "work-timesheet-friday", intervalMinutes: 30, run: timesheetFriday },
  { name: "work-timesheet-waiting", intervalMinutes: 120, run: timesheetWaiting },
];
