"use server";

import { and, eq } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can, type CurrentUser } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { resolveFileRefs } from "@/lib/files";
import { db } from "@/lib/db";
import { newId, Project, PRIORITIES, Task, User, type Id, type TaskSubmission } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { inList, jsonPush, notInList } from "@/lib/sql";
import { optionLabel } from "@/lib/status";
import { isObjectId, zs } from "@/lib/validation";
import {
  allowedTaskStatuses,
  canCreateTask,
  categoryOf,
  firstInCategory,
  historyEntry,
  keysInCategories,
  projectFilter,
  taskCaps,
  taskFilter,
  TASK_CLOSED_CATEGORIES,
} from "@/lib/work-access";

const taskSchema = z.object({
  project: zs.optId(),
  milestone: zs.optId(),
  parent: zs.optId(),
  title: zs.text("Title", 300),
  description: zs.optText(20000),
  assignees: zs.ids(),
  reviewer: zs.optId(),
  priority: z.enum(PRIORITIES, { error: "Choose a priority" }),
  startDate: zs.optDate(),
  dueDate: zs.optDate(),
  estimateHours: zs.optNum({ min: 0, max: 10000 }),
  dependencies: zs.ids(),
  sharedWith: zs.ids(),
  isLearning: zs.bool(),
});

type TaskInput = z.infer<typeof taskSchema>;

/** File refs get an id when embedded (they were sub-documents before), so they can be addressed later. */
const withIds = <T extends { _id?: Id }>(refs: T[]): T[] => refs.map((r) => ({ ...r, _id: r._id ?? newId() }));

/** Loads a task the user may see, with the project manager and the user's capabilities on it. */
async function loadTask(user: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new ActionError("Task not found.");
  const filter = await taskFilter(user);
  const [task] = await db().select().from(Task).where(and(eq(Task._id, id), filter)).limit(1);
  if (!task) throw new ActionError("Task not found, or you don't have access to it.");
  const [project] = task.project
    ? await db().select({ manager: Project.manager, title: Project.title, projectNo: Project.projectNo, milestones: Project.milestones }).from(Project).where(eq(Project._id, task.project)).limit(1)
    : [];
  return { task, project, caps: taskCaps(user, task, project?.manager) };
}

async function assertStaff(ids: string[], field: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const count = await db().$count(User, and(inList(User._id, unique), inList(User.personType, ["employee", "trainee", "intern"]), notInList(User.status, EXITED_STATUSES)));
  if (count !== unique.length) throw new ActionError("Choose active staff members only.", { [field]: "Choose active staff members only." });
}

/** True when following `dependencies` from `start` ever reaches `target` (circular dependency). */
async function dependsOn(start: string[], target: string): Promise<boolean> {
  const seen = new Set<string>();
  let frontier = start;
  for (let depth = 0; depth < 25 && frontier.length; depth++) {
    if (frontier.includes(target)) return true;
    const fresh = frontier.filter((x) => !seen.has(x));
    fresh.forEach((x) => seen.add(x));
    if (fresh.length === 0) return false;
    const rows = await db().select({ dependencies: Task.dependencies }).from(Task).where(inList(Task._id, fresh));
    frontier = rows.flatMap((r) => r.dependencies);
  }
  return false;
}

/**
 * Validates the relations of a task form against its project. When editing, people already on the task (`existing`)
 * are not re-checked, so a task whose assignee or reviewer has since left can still be edited (and the leaver removed).
 */
async function validateTaskInput(data: TaskInput, projectId: string | undefined, selfId?: string, existing?: { assignees: string[]; sharedWith: string[]; reviewer?: string | null }) {
  if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
    throw new ActionError("The due date is before the start date.", { dueDate: "Must be on or after the start date" });
  }
  const added = (ids: string[], current: string[] = []) => ids.filter((x) => !current.includes(x));
  await assertStaff(added(data.assignees, existing?.assignees), "assignees");
  await assertStaff(added(data.sharedWith, existing?.sharedWith), "sharedWith");
  if (data.reviewer && data.reviewer !== existing?.reviewer) await assertStaff([data.reviewer], "reviewer");
  if (data.milestone) {
    const [project] = projectId ? await db().select({ milestones: Project.milestones }).from(Project).where(eq(Project._id, projectId)).limit(1) : [];
    if (!project?.milestones.some((m) => m._id === data.milestone)) {
      throw new ActionError("That milestone doesn't belong to the project.", { milestone: "Choose a milestone of this project" });
    }
  }
  if (data.dependencies.length) {
    if (selfId && data.dependencies.includes(selfId)) throw new ActionError("A task can't depend on itself.", { dependencies: "A task can't depend on itself" });
    const deps = await db().select({ project: Task.project }).from(Task).where(inList(Task._id, data.dependencies));
    const sameProject = deps.every((d) => (d.project ?? "") === (projectId ?? ""));
    if (deps.length !== new Set(data.dependencies).size || !sameProject) {
      throw new ActionError("Dependencies must be tasks of the same project.", { dependencies: "Choose tasks of the same project" });
    }
    if (selfId && (await dependsOn(data.dependencies, selfId))) {
      throw new ActionError("That would create a circular dependency.", { dependencies: "Circular dependency" });
    }
  }
}

function recipients(task: { assignees: Id[]; reporter?: Id | null; reviewer?: Id | null; sharedWith?: Id[] }, projectManager?: Id | null) {
  return [...task.assignees, task.reporter, task.reviewer, projectManager, ...(task.sharedWith ?? [])];
}

/* ------------------------------------------------------------------ */
/* Create / update                                                     */
/* ------------------------------------------------------------------ */

export async function createTask(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(taskSchema, input);
    const settings = await getSettings();

    let projectId = data.project;
    let milestone = data.milestone;
    let parentTask: { _id: Id; project: Id | null; parent: Id | null; milestone: Id | null } | undefined;
    if (data.parent) {
      [parentTask] = await db()
        .select({ _id: Task._id, project: Task.project, parent: Task.parent, milestone: Task.milestone })
        .from(Task)
        .where(and(eq(Task._id, data.parent), await taskFilter(user)))
        .limit(1);
      if (!parentTask) throw new ActionError("The parent task no longer exists, or you don't have access to it.", { parent: "Not found" });
      if (parentTask.parent) throw new ActionError("Subtasks can't have their own subtasks.", { parent: "Choose a top-level task" });
      if (data.project && data.project !== (parentTask.project ?? "")) {
        throw new ActionError("The parent task belongs to a different project.", { parent: "Choose a task of the same project" });
      }
      projectId = parentTask.project ?? undefined;
      milestone = milestone ?? parentTask.milestone ?? undefined;
    }
    const [project] = projectId
      ? await db().select({ _id: Project._id, manager: Project.manager, title: Project.title }).from(Project).where(and(eq(Project._id, projectId), projectFilter(user))).limit(1)
      : [];
    if (projectId && !project) throw new ActionError("The project no longer exists, or you don't have access to it.", { project: "Not found" });
    if (!projectId && !can(user, "tasks.manage")) throw new ActionError("Choose a project.", { project: "Choose a project" });
    if (!canCreateTask(user, project)) throw new ActionError("You don't have permission to create tasks in this project.");
    const withProject = { ...data, milestone };
    await validateTaskInput(withProject, projectId);

    const status = firstInCategory(settings.taskStatuses, "open") ?? settings.taskStatuses[0]?.key;
    if (!status) throw new ActionError("No task statuses are configured.");
    const taskNo = await nextNumber("task", ID_PREFIX.task, 4);
    const [task] = await db()
      .insert(Task)
      .values({
        taskNo,
        project: project?._id,
        milestone,
        parent: parentTask?._id,
        title: data.title,
        description: data.description,
        assignees: data.assignees,
        sharedWith: data.sharedWith,
        reporter: user._id,
        reviewer: data.reviewer,
        priority: data.priority,
        status,
        startDate: data.startDate,
        dueDate: data.dueDate,
        estimateHours: data.estimateHours ?? 0,
        dependencies: data.dependencies,
        isLearning: data.isLearning,
        history: [historyEntry(user, parentTask ? "Subtask created" : "Task created", { to: optionLabel(settings.taskStatuses, status) })],
      })
      .returning();

    await audit(user, { action: "create", entity: "task", entityId: task._id, ref: taskNo, summary: `Created task ${taskNo}: ${task.title}` });
    await notify(
      data.assignees,
      { type: "task", title: `New task assigned: ${task.title}`, body: `${taskNo}${project ? ` · ${project.title}` : ""}${data.dueDate ? ` · due ${data.dueDate}` : ""}`, link: `/tasks/${task._id}`, priority: data.priority === "urgent" ? "high" : "normal" },
      [user._id],
    );
    if (data.reviewer && !data.assignees.includes(data.reviewer)) {
      await notify([data.reviewer], { type: "task", title: `You will review: ${task.title}`, body: taskNo, link: `/tasks/${task._id}` }, [user._id]);
    }
    return { id: task._id };
  }, "Task created");
}

export async function updateTask(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const { task, project, caps } = await loadTask(user, id);
    if (!caps.manage) throw new ActionError("You don't have permission to edit this task.");
    const data = parse(taskSchema, input);
    const projectId = task.project ?? undefined;
    await validateTaskInput(data, projectId, task._id, task);

    const before = {
      title: task.title,
      description: task.description ?? undefined,
      priority: task.priority,
      startDate: task.startDate ?? undefined,
      dueDate: task.dueDate ?? undefined,
      estimateHours: task.estimateHours,
      reviewer: task.reviewer ?? undefined,
      milestone: task.milestone ?? undefined,
      assignees: [...task.assignees].sort().join(","),
      dependencies: [...task.dependencies].sort().join(","),
      sharedWith: [...task.sharedWith].sort().join(","),
      isLearning: task.isLearning,
    };
    const previousAssignees = [...task.assignees];

    const after = {
      title: data.title,
      description: data.description,
      priority: data.priority,
      startDate: data.startDate,
      dueDate: data.dueDate,
      estimateHours: data.estimateHours ?? 0,
      reviewer: data.reviewer,
      milestone: data.milestone,
      assignees: [...data.assignees].sort().join(","),
      dependencies: [...data.dependencies].sort().join(","),
      sharedWith: [...data.sharedWith].sort().join(","),
      isLearning: data.isLearning,
    };
    const changes = diff(before, after, ["title", "description", "priority", "startDate", "dueDate", "estimateHours", "reviewer", "milestone", "assignees", "dependencies", "sharedWith", "isLearning"]);
    if (changes.length === 0) return { id: task._id };
    await db()
      .update(Task)
      .set({
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        startDate: data.startDate ?? null,
        dueDate: data.dueDate ?? null,
        estimateHours: data.estimateHours ?? 0,
        reviewer: data.reviewer ?? null,
        milestone: data.milestone ?? null,
        assignees: data.assignees,
        dependencies: data.dependencies,
        sharedWith: data.sharedWith,
        isLearning: data.isLearning,
        history: jsonPush(Task.history, historyEntry(user, "Task updated", { note: changes.map((c) => c.field).join(", ") })),
      })
      .where(eq(Task._id, task._id));

    await audit(user, { action: "update", entity: "task", entityId: task._id, ref: task.taskNo, summary: `Updated task ${task.taskNo}`, changes });
    const added = data.assignees.filter((a) => !previousAssignees.includes(a));
    const removed = previousAssignees.filter((a) => !data.assignees.includes(a));
    if (added.length) {
      await audit(user, { action: "assign", entity: "task", entityId: task._id, ref: task.taskNo, summary: `Assigned ${task.taskNo} to ${added.length} ${added.length === 1 ? "person" : "people"}` });
      await notify(added, { type: "task", title: `Task assigned to you: ${data.title}`, body: `${task.taskNo}${project ? ` · ${project.title}` : ""}`, link: `/tasks/${task._id}` }, [user._id]);
    }
    if (removed.length) {
      await notify(removed, { type: "task", title: `You were removed from: ${data.title}`, body: task.taskNo, link: `/tasks/${task._id}` }, [user._id]);
    }
    const stillOn = data.assignees.filter((a) => !added.includes(a));
    if (changes.some((c) => ["dueDate", "priority", "title"].includes(c.field)) && stillOn.length) {
      await notify(stillOn, { type: "task", title: `Task updated: ${data.title}`, body: `${task.taskNo} · ${changes.map((c) => c.field).join(", ")} changed`, link: `/tasks/${task._id}` }, [user._id]);
    }
    return { id: task._id };
  }, "Task updated");
}

/* ------------------------------------------------------------------ */
/* Status, progress, blocker                                           */
/* ------------------------------------------------------------------ */

export async function changeTaskStatus(id: string, status: string, rawNote?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const note = parse(zs.optText(2000), rawNote);
    const { task, project, caps } = await loadTask(user, id);
    const settings = await getSettings();
    const options = settings.taskStatuses;
    if (!options.some((s) => s.key === status)) throw new ActionError("Unknown status.");
    if (status === task.status) return null;
    if (!allowedTaskStatuses(settings, caps, task).includes(status)) {
      const targetCat = categoryOf(options, status);
      if (caps.isAssignee && caps.intern && (targetCat === "review" || targetCat === "done")) {
        throw new ActionError("Submit your work for review instead — a reviewer will approve it.");
      }
      if (caps.isAssignee && task.reviewer && targetCat === "done") throw new ActionError("This task needs reviewer approval before it can be marked done.");
      throw new ActionError("You can't move this task to that status.");
    }

    const targetCat = categoryOf(options, status);
    if (targetCat === "done") {
      const unmet = await db()
        .select({ taskNo: Task.taskNo })
        .from(Task)
        .where(and(inList(Task._id, task.dependencies), notInList(Task.status, keysInCategories(options, TASK_CLOSED_CATEGORIES))));
      if (unmet.length) throw new ActionError(`Finish the dependencies first: ${unmet.map((t) => t.taskNo).join(", ")}.`);
    }

    const previous = task.status;
    const wasDone = categoryOf(options, previous) === "done";
    const patch: SQLiteUpdateSetSource<typeof Task> = { status };
    if (targetCat === "done") {
      patch.progress = 100;
      patch.completedAt = new Date();
    } else if (wasDone) {
      patch.completedAt = null;
    }
    if (targetCat === "blocked") {
      if (note?.trim()) patch.blocker = note.trim();
    } else if (categoryOf(options, previous) === "blocked") {
      patch.blocker = null;
    }
    patch.history = jsonPush(Task.history, historyEntry(user, "Status changed", { from: optionLabel(options, previous), to: optionLabel(options, status), note: note?.trim() || undefined }));
    await db().update(Task).set(patch).where(eq(Task._id, task._id));

    await audit(user, { action: "status", entity: "task", entityId: task._id, ref: task.taskNo, summary: `${task.taskNo}: ${optionLabel(options, previous)} → ${optionLabel(options, status)}` });
    const text = `${task.taskNo} moved to ${optionLabel(options, status)}`;
    if (targetCat === "review") {
      await notify([task.reviewer, task.reporter, project?.manager], { type: "task", title: `Ready for review: ${task.title}`, body: text, link: `/tasks/${task._id}`, actionable: true }, [user._id]);
    } else if (caps.isAssignee) {
      await notify([task.reporter, project?.manager, task.reviewer], { type: "task", title: `Task update: ${task.title}`, body: text, link: `/tasks/${task._id}` }, [user._id]);
    } else {
      await notify(task.assignees, { type: "task", title: `Task update: ${task.title}`, body: text, link: `/tasks/${task._id}` }, [user._id]);
    }
    return null;
  });
}

export async function updateTaskProgress(id: string, progress: number): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const value = parse(zs.num("Progress", { min: 0, max: 100 }), progress);
    const { task, caps } = await loadTask(user, id);
    const settings = await getSettings();
    if (!caps.isAssignee && !caps.manage) throw new ActionError("Only the assignees can update progress.");
    if (categoryOf(settings.taskStatuses, task.status) === "done" && !caps.manage) throw new ActionError("This task is already done.");
    const rounded = Math.round(value);
    if (rounded === task.progress) return null;
    const previous = task.progress;
    await db()
      .update(Task)
      .set({ progress: rounded, history: jsonPush(Task.history, historyEntry(user, "Progress updated", { from: `${previous}%`, to: `${rounded}%` })) })
      .where(eq(Task._id, task._id));
    return null;
  }, "Progress saved");
}

export async function updateTaskBlocker(id: string, blocker: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { task, caps } = await loadTask(user, id);
    if (!caps.isAssignee && !caps.manage) throw new ActionError("Only the assignees can update the blocker note.");
    const text = blocker.trim().slice(0, 1000);
    await db()
      .update(Task)
      .set({ blocker: text || null, history: jsonPush(Task.history, historyEntry(user, text ? "Blocker noted" : "Blocker cleared", { note: text || undefined })) })
      .where(eq(Task._id, task._id));
    return null;
  }, "Blocker note saved");
}

/* ------------------------------------------------------------------ */
/* Subtasks, comments, attachments                                     */
/* ------------------------------------------------------------------ */

export async function addSubtask(parentId: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ title: zs.text("Title", 300) }), input);
    const { task: parent, project, caps } = await loadTask(user, parentId);
    if (!caps.manage && !caps.isAssignee) throw new ActionError("Only the assignees or a manager can add subtasks.");
    if (parent.parent) throw new ActionError("Subtasks can't have their own subtasks.");
    const settings = await getSettings();
    const status = firstInCategory(settings.taskStatuses, "open") ?? settings.taskStatuses[0]?.key;
    if (!status) throw new ActionError("No task statuses are configured.");
    const taskNo = await nextNumber("task", ID_PREFIX.task, 4);
    const [sub] = await db()
      .insert(Task)
      .values({
        taskNo,
        project: parent.project,
        milestone: parent.milestone,
        parent: parent._id,
        title: data.title,
        assignees: parent.assignees,
        reporter: user._id,
        reviewer: parent.reviewer,
        priority: parent.priority,
        status,
        dueDate: parent.dueDate,
        history: [historyEntry(user, "Subtask created", { note: `Added under ${parent.taskNo}` })],
      })
      .returning();
    await audit(user, { action: "create", entity: "task", entityId: sub._id, ref: taskNo, summary: `Created subtask ${taskNo} under ${parent.taskNo}` });
    await notify(parent.assignees, { type: "task", title: `New subtask: ${data.title}`, body: `${taskNo} under ${parent.taskNo}${project ? ` · ${project.title}` : ""}`, link: `/tasks/${sub._id}` }, [user._id]);
    return { id: sub._id };
  }, "Subtask added");
}

export async function addTaskComment(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ text: zs.text("Comment", 5000), attachments: zs.ids() }), input);
    const { task, project } = await loadTask(user, id);
    const attachments = await resolveFileRefs(user, data.attachments);
    await db()
      .update(Task)
      .set({ comments: jsonPush(Task.comments, { _id: newId(), user: user._id, userName: user.name, text: data.text, attachments: withIds(attachments), at: new Date() }) })
      .where(eq(Task._id, task._id));
    await notify(recipients(task, project?.manager), { type: "task", title: `${user.name} commented on ${task.taskNo}`, body: data.text.slice(0, 200), link: `/tasks/${task._id}` }, [user._id]);
    return null;
  }, "Comment added");
}

export async function addTaskAttachments(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ attachments: zs.ids() }), input);
    const { task, caps } = await loadTask(user, id);
    if (!caps.attach) throw new ActionError("You can't attach files to this task.");
    const files = await resolveFileRefs(user, data.attachments);
    if (files.length === 0) throw new ActionError("Choose at least one file to attach.");
    await db()
      .update(Task)
      .set({
        attachments: jsonPush(Task.attachments, ...withIds(files)),
        history: jsonPush(Task.history, historyEntry(user, "Files attached", { note: files.map((f) => f.name).join(", ") })),
      })
      .where(eq(Task._id, task._id));
    return null;
  }, "Files attached");
}

/* ------------------------------------------------------------------ */
/* Work submissions & review                                           */
/* ------------------------------------------------------------------ */

const submitSchema = z.object({
  note: zs.text("Note", 5000),
  link: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
    z
      .url({ error: "Enter a valid link" })
      .refine((u) => /^https?:\/\//i.test(u), "Links must start with http:// or https://")
      .optional(),
  ),
  attachments: zs.ids(),
});

export async function submitWork(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(submitSchema, input);
    const { task, project, caps } = await loadTask(user, id);
    if (!caps.isAssignee) throw new ActionError("Only the assignees can submit work for review.");
    const settings = await getSettings();
    const cat = categoryOf(settings.taskStatuses, task.status);
    if (cat === "done" || cat === "cancelled") throw new ActionError("This task is already closed.");
    const stale = task.submissions.some((s) => s.reviewStatus === "pending");
    if (stale && cat === "review") throw new ActionError("Your previous submission is still awaiting review.");
    const reviewStatus = firstInCategory(settings.taskStatuses, "review");
    if (!reviewStatus) throw new ActionError("No review status is configured. Ask an administrator to add one.");

    const attachments = await resolveFileRefs(user, data.attachments);
    const previous = task.status;
    const submission: TaskSubmission = { _id: newId(), note: data.note, link: data.link, attachments: withIds(attachments), submittedBy: user._id, submittedByName: user.name, submittedAt: new Date(), reviewStatus: "pending" };
    // A submission left "pending" after the task was moved out of review (pulled back, reopened) is superseded by this one.
    const superseded = stale
      ? [...task.submissions.map((s) => (s.reviewStatus === "pending" ? { ...s, reviewStatus: "changes_requested" as const, reviewNote: s.reviewNote ?? "Superseded by a newer submission" } : s)), submission]
      : null;
    await db()
      .update(Task)
      .set({
        submissions: superseded ?? jsonPush(Task.submissions, submission),
        status: reviewStatus,
        history: jsonPush(Task.history, historyEntry(user, "Work submitted for review", { from: optionLabel(settings.taskStatuses, previous), to: optionLabel(settings.taskStatuses, reviewStatus), note: data.note.slice(0, 300) })),
      })
      .where(eq(Task._id, task._id));

    await audit(user, { action: "submit", entity: "task", entityId: task._id, ref: task.taskNo, summary: `${user.name} submitted work on ${task.taskNo} for review` });
    const targets = [task.reviewer, task.reporter, project?.manager].filter((x) => x && x !== user.id);
    if (targets.length) {
      await notify(targets, { type: "task", title: `Work submitted for review: ${task.title}`, body: `${user.name} · ${task.taskNo}`, link: `/tasks/${task._id}`, actionable: true }, [user._id]);
    } else {
      await notifyPermission("tasks.review", { type: "task", title: `Work submitted for review: ${task.title}`, body: `${user.name} · ${task.taskNo}`, link: `/tasks/${task._id}`, actionable: true }, [user._id]);
    }
    return null;
  }, "Submitted for review");
}

async function reviewable(user: CurrentUser, id: string) {
  const loaded = await loadTask(user, id);
  const settings = await getSettings();
  if (!loaded.caps.review) throw new ActionError("You can't review this task.");
  if (loaded.caps.isAssignee) throw new ActionError("You can't review your own work.");
  if (categoryOf(settings.taskStatuses, loaded.task.status) !== "review") throw new ActionError("This task isn't awaiting review.");
  return { ...loaded, settings };
}

export async function approveSubmission(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ rating: zs.optNum({ min: 1, max: 5 }), note: zs.optText(2000) }), input);
    const { task, settings } = await reviewable(user, id);
    const doneStatus = firstInCategory(settings.taskStatuses, "done");
    if (!doneStatus) throw new ActionError("No done status is configured. Ask an administrator to add one.");
    const unmet = await db()
      .select({ taskNo: Task.taskNo })
      .from(Task)
      .where(and(inList(Task._id, task.dependencies), notInList(Task.status, keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES))));
    if (unmet.length) throw new ActionError(`Finish the dependencies first: ${unmet.map((t) => t.taskNo).join(", ")}.`);

    const submissions = [...task.submissions];
    const pending = [...submissions].reverse().find((s) => s.reviewStatus === "pending");
    if (pending) {
      pending.reviewStatus = "approved";
      pending.reviewedBy = user._id;
      pending.reviewedByName = user.name;
      pending.reviewedAt = new Date();
      pending.reviewNote = data.note;
      if (data.rating !== undefined) pending.rating = Math.round(data.rating);
    }
    const previous = task.status;
    await db()
      .update(Task)
      .set({
        ...(pending ? { submissions } : {}),
        status: doneStatus,
        progress: 100,
        completedAt: new Date(),
        blocker: null,
        history: jsonPush(
          Task.history,
          historyEntry(user, "Work approved", {
            from: optionLabel(settings.taskStatuses, previous),
            to: optionLabel(settings.taskStatuses, doneStatus),
            note: [data.rating ? `Rating ${Math.round(data.rating)}/5` : "", data.note ?? ""].filter(Boolean).join(" · ") || undefined,
          }),
        ),
      })
      .where(eq(Task._id, task._id));

    await audit(user, { action: "approve", entity: "task", entityId: task._id, ref: task.taskNo, summary: `Approved work on ${task.taskNo}${data.rating ? ` (rating ${Math.round(data.rating)}/5)` : ""}` });
    await notify(task.assignees, { type: "task", title: `Work approved: ${task.title}`, body: data.note ?? `${task.taskNo} is done`, link: `/tasks/${task._id}` }, [user._id]);
    return null;
  }, "Work approved");
}

export async function requestTaskChanges(id: string, note: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const reason = parse(zs.text("Note", 2000), note);
    const { task, settings } = await reviewable(user, id);
    const activeStatus = firstInCategory(settings.taskStatuses, "active") ?? firstInCategory(settings.taskStatuses, "open");
    if (!activeStatus) throw new ActionError("No active status is configured.");

    const submissions = [...task.submissions];
    const pending = [...submissions].reverse().find((s) => s.reviewStatus === "pending");
    if (pending) {
      pending.reviewStatus = "changes_requested";
      pending.reviewedBy = user._id;
      pending.reviewedByName = user.name;
      pending.reviewedAt = new Date();
      pending.reviewNote = reason;
    }
    const previous = task.status;
    await db()
      .update(Task)
      .set({
        ...(pending ? { submissions } : {}),
        status: activeStatus,
        history: jsonPush(Task.history, historyEntry(user, "Changes requested", { from: optionLabel(settings.taskStatuses, previous), to: optionLabel(settings.taskStatuses, activeStatus), note: reason })),
      })
      .where(eq(Task._id, task._id));

    await audit(user, { action: "reject", entity: "task", entityId: task._id, ref: task.taskNo, summary: `Requested changes on ${task.taskNo}` });
    await notify(task.assignees, { type: "task", title: `Changes requested: ${task.title}`, body: reason.slice(0, 200), link: `/tasks/${task._id}`, actionable: true, priority: "high" }, [user._id]);
    return null;
  }, "Changes requested");
}
