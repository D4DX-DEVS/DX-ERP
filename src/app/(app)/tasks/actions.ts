"use server";

import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can, type CurrentUser } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { resolveFileRefs } from "@/lib/files";
import { Project, PRIORITIES, Task, User, type ObjectId } from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { getSettings } from "@/lib/settings";
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

const idList = (ids: { toString(): string }[]) => ids.map((x) => x.toString());

/** Loads a task the user may see, with the project manager and the user's capabilities on it. */
async function loadTask(user: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new ActionError("Task not found.");
  const filter = await taskFilter(user);
  const task = await Task.findOne({ $and: [{ _id: id }, filter] });
  if (!task) throw new ActionError("Task not found, or you don't have access to it.");
  const project = task.project ? await Project.findById(task.project, { manager: 1, title: 1, projectNo: 1, milestones: 1 }).lean() : null;
  return { task, project, caps: taskCaps(user, task, project?.manager) };
}

async function assertStaff(ids: string[], field: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const count = await User.countDocuments({ _id: { $in: unique }, personType: { $in: ["employee", "trainee", "intern"] }, status: { $nin: EXITED_STATUSES } });
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
    const rows = await Task.find({ _id: { $in: fresh } }, { dependencies: 1 }).lean();
    frontier = rows.flatMap((r) => r.dependencies.map((d) => d.toString()));
  }
  return false;
}

/** Validates the relations of a task form against its project. */
async function validateTaskInput(data: TaskInput, projectId: string | undefined, selfId?: string) {
  if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
    throw new ActionError("The due date is before the start date.", { dueDate: "Must be on or after the start date" });
  }
  await assertStaff(data.assignees, "assignees");
  await assertStaff(data.sharedWith, "sharedWith");
  if (data.reviewer) await assertStaff([data.reviewer], "reviewer");
  if (data.milestone) {
    const project = projectId ? await Project.findById(projectId, { milestones: 1 }).lean() : null;
    if (!project?.milestones.some((m) => m._id.toString() === data.milestone)) {
      throw new ActionError("That milestone doesn't belong to the project.", { milestone: "Choose a milestone of this project" });
    }
  }
  if (data.dependencies.length) {
    if (selfId && data.dependencies.includes(selfId)) throw new ActionError("A task can't depend on itself.", { dependencies: "A task can't depend on itself" });
    const deps = await Task.find({ _id: { $in: data.dependencies } }, { project: 1 }).lean();
    const sameProject = deps.every((d) => (d.project?.toString() ?? "") === (projectId ?? ""));
    if (deps.length !== new Set(data.dependencies).size || !sameProject) {
      throw new ActionError("Dependencies must be tasks of the same project.", { dependencies: "Choose tasks of the same project" });
    }
    if (selfId && (await dependsOn(data.dependencies, selfId))) {
      throw new ActionError("That would create a circular dependency.", { dependencies: "Circular dependency" });
    }
  }
}

function recipients(task: { assignees: ObjectId[]; reporter?: ObjectId | null; reviewer?: ObjectId | null; sharedWith?: ObjectId[] }, projectManager?: ObjectId | null) {
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
    let parentTask = null;
    if (data.parent) {
      parentTask = await Task.findOne({ $and: [{ _id: data.parent }, await taskFilter(user)] }, { project: 1, parent: 1, milestone: 1 }).lean();
      if (!parentTask) throw new ActionError("The parent task no longer exists, or you don't have access to it.", { parent: "Not found" });
      if (parentTask.parent) throw new ActionError("Subtasks can't have their own subtasks.", { parent: "Choose a top-level task" });
      if (data.project && data.project !== (parentTask.project?.toString() ?? "")) {
        throw new ActionError("The parent task belongs to a different project.", { parent: "Choose a task of the same project" });
      }
      projectId = parentTask.project?.toString();
      milestone = milestone ?? parentTask.milestone?.toString();
    }
    const project = projectId ? await Project.findOne({ $and: [{ _id: projectId }, projectFilter(user)] }, { manager: 1, title: 1 }).lean() : null;
    if (projectId && !project) throw new ActionError("The project no longer exists, or you don't have access to it.", { project: "Not found" });
    if (!projectId && !can(user, "tasks.manage")) throw new ActionError("Choose a project.", { project: "Choose a project" });
    if (!canCreateTask(user, project)) throw new ActionError("You don't have permission to create tasks in this project.");
    const withProject = { ...data, milestone };
    await validateTaskInput(withProject, projectId);

    const status = firstInCategory(settings.taskStatuses, "open") ?? settings.taskStatuses[0]?.key;
    if (!status) throw new ActionError("No task statuses are configured.");
    const taskNo = await nextNumber("task", ID_PREFIX.task, 4);
    const task = await Task.create({
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
    });

    await audit(user, { action: "create", entity: "task", entityId: task._id, ref: taskNo, summary: `Created task ${taskNo}: ${task.title}` });
    await notify(
      data.assignees,
      { type: "task", title: `New task assigned: ${task.title}`, body: `${taskNo}${project ? ` · ${project.title}` : ""}${data.dueDate ? ` · due ${data.dueDate}` : ""}`, link: `/tasks/${task._id}`, priority: data.priority === "urgent" ? "high" : "normal" },
      [user._id],
    );
    if (data.reviewer && !data.assignees.includes(data.reviewer)) {
      await notify([data.reviewer], { type: "task", title: `You will review: ${task.title}`, body: taskNo, link: `/tasks/${task._id}` }, [user._id]);
    }
    return { id: task._id.toString() };
  }, "Task created");
}

export async function updateTask(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const { task, project, caps } = await loadTask(user, id);
    if (!caps.manage) throw new ActionError("You don't have permission to edit this task.");
    const data = parse(taskSchema, input);
    const projectId = task.project?.toString();
    await validateTaskInput(data, projectId, task._id.toString());

    const before = {
      title: task.title,
      description: task.description,
      priority: task.priority,
      startDate: task.startDate,
      dueDate: task.dueDate,
      estimateHours: task.estimateHours,
      reviewer: task.reviewer?.toString(),
      milestone: task.milestone?.toString(),
      assignees: idList(task.assignees).sort().join(","),
      dependencies: idList(task.dependencies).sort().join(","),
      sharedWith: idList(task.sharedWith).sort().join(","),
      isLearning: task.isLearning,
    };
    const previousAssignees = idList(task.assignees);

    task.title = data.title;
    task.description = data.description;
    task.priority = data.priority;
    task.startDate = data.startDate;
    task.dueDate = data.dueDate;
    task.estimateHours = data.estimateHours ?? 0;
    task.set("reviewer", data.reviewer);
    task.set("milestone", data.milestone);
    task.set("assignees", data.assignees);
    task.set("dependencies", data.dependencies);
    task.set("sharedWith", data.sharedWith);
    task.isLearning = data.isLearning;

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
    if (changes.length === 0) return { id: task._id.toString() };
    task.history.push(historyEntry(user, "Task updated", { note: changes.map((c) => c.field).join(", ") }));
    await task.save();

    await audit(user, { action: "update", entity: "task", entityId: task._id, ref: task.taskNo, summary: `Updated task ${task.taskNo}`, changes });
    const added = data.assignees.filter((a) => !previousAssignees.includes(a));
    const removed = previousAssignees.filter((a) => !data.assignees.includes(a));
    if (added.length) {
      await audit(user, { action: "assign", entity: "task", entityId: task._id, ref: task.taskNo, summary: `Assigned ${task.taskNo} to ${added.length} ${added.length === 1 ? "person" : "people"}` });
      await notify(added, { type: "task", title: `Task assigned to you: ${task.title}`, body: `${task.taskNo}${project ? ` · ${project.title}` : ""}`, link: `/tasks/${task._id}` }, [user._id]);
    }
    if (removed.length) {
      await notify(removed, { type: "task", title: `You were removed from: ${task.title}`, body: task.taskNo, link: `/tasks/${task._id}` }, [user._id]);
    }
    const stillOn = data.assignees.filter((a) => !added.includes(a));
    if (changes.some((c) => ["dueDate", "priority", "title"].includes(c.field)) && stillOn.length) {
      await notify(stillOn, { type: "task", title: `Task updated: ${task.title}`, body: `${task.taskNo} · ${changes.map((c) => c.field).join(", ")} changed`, link: `/tasks/${task._id}` }, [user._id]);
    }
    return { id: task._id.toString() };
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
      const unmet = await Task.find({ _id: { $in: task.dependencies }, status: { $nin: keysInCategories(options, TASK_CLOSED_CATEGORIES) } }, { taskNo: 1 }).lean();
      if (unmet.length) throw new ActionError(`Finish the dependencies first: ${unmet.map((t) => t.taskNo).join(", ")}.`);
    }

    const previous = task.status;
    const wasDone = categoryOf(options, previous) === "done";
    task.status = status;
    if (targetCat === "done") {
      task.progress = 100;
      task.completedAt = new Date();
    } else if (wasDone) {
      task.completedAt = undefined;
    }
    if (targetCat === "blocked") {
      if (note?.trim()) task.blocker = note.trim();
    } else if (categoryOf(options, previous) === "blocked") {
      task.blocker = undefined;
    }
    task.history.push(historyEntry(user, "Status changed", { from: optionLabel(options, previous), to: optionLabel(options, status), note: note?.trim() || undefined }));
    await task.save();

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
    task.progress = rounded;
    task.history.push(historyEntry(user, "Progress updated", { from: `${previous}%`, to: `${rounded}%` }));
    await task.save();
    return null;
  }, "Progress saved");
}

export async function updateTaskBlocker(id: string, blocker: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { task, caps } = await loadTask(user, id);
    if (!caps.isAssignee && !caps.manage) throw new ActionError("Only the assignees can update the blocker note.");
    const text = blocker.trim().slice(0, 1000);
    task.blocker = text || undefined;
    task.history.push(historyEntry(user, text ? "Blocker noted" : "Blocker cleared", { note: text || undefined }));
    await task.save();
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
    const sub = await Task.create({
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
    });
    await audit(user, { action: "create", entity: "task", entityId: sub._id, ref: taskNo, summary: `Created subtask ${taskNo} under ${parent.taskNo}` });
    await notify(parent.assignees, { type: "task", title: `New subtask: ${data.title}`, body: `${taskNo} under ${parent.taskNo}${project ? ` · ${project.title}` : ""}`, link: `/tasks/${sub._id}` }, [user._id]);
    return { id: sub._id.toString() };
  }, "Subtask added");
}

export async function addTaskComment(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ text: zs.text("Comment", 5000), attachments: zs.ids() }), input);
    const { task, project } = await loadTask(user, id);
    const attachments = await resolveFileRefs(user, data.attachments);
    task.comments.push({ user: user._id, userName: user.name, text: data.text, attachments, at: new Date() });
    await task.save();
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
    task.attachments.push(...files);
    task.history.push(historyEntry(user, "Files attached", { note: files.map((f) => f.name).join(", ") }));
    await task.save();
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
    if (task.submissions.some((s) => s.reviewStatus === "pending")) throw new ActionError("Your previous submission is still awaiting review.");
    const reviewStatus = firstInCategory(settings.taskStatuses, "review");
    if (!reviewStatus) throw new ActionError("No review status is configured. Ask an administrator to add one.");

    const attachments = await resolveFileRefs(user, data.attachments);
    const previous = task.status;
    task.submissions.push({ note: data.note, link: data.link, attachments, submittedBy: user._id, submittedByName: user.name, submittedAt: new Date(), reviewStatus: "pending" });
    task.status = reviewStatus;
    task.history.push(historyEntry(user, "Work submitted for review", { from: optionLabel(settings.taskStatuses, previous), to: optionLabel(settings.taskStatuses, reviewStatus), note: data.note.slice(0, 300) }));
    await task.save();

    await audit(user, { action: "submit", entity: "task", entityId: task._id, ref: task.taskNo, summary: `${user.name} submitted work on ${task.taskNo} for review` });
    const targets = [task.reviewer, task.reporter, project?.manager].filter((x) => x && x.toString() !== user.id);
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
    const unmet = await Task.find({ _id: { $in: task.dependencies }, status: { $nin: keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES) } }, { taskNo: 1 }).lean();
    if (unmet.length) throw new ActionError(`Finish the dependencies first: ${unmet.map((t) => t.taskNo).join(", ")}.`);

    const pending = [...task.submissions].reverse().find((s) => s.reviewStatus === "pending");
    if (pending) {
      pending.reviewStatus = "approved";
      pending.reviewedBy = user._id;
      pending.reviewedByName = user.name;
      pending.reviewedAt = new Date();
      pending.reviewNote = data.note;
      if (data.rating !== undefined) pending.rating = Math.round(data.rating);
    }
    const previous = task.status;
    task.status = doneStatus;
    task.progress = 100;
    task.completedAt = new Date();
    task.blocker = undefined;
    task.history.push(
      historyEntry(user, "Work approved", {
        from: optionLabel(settings.taskStatuses, previous),
        to: optionLabel(settings.taskStatuses, doneStatus),
        note: [data.rating ? `Rating ${Math.round(data.rating)}/5` : "", data.note ?? ""].filter(Boolean).join(" · ") || undefined,
      }),
    );
    await task.save();

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

    const pending = [...task.submissions].reverse().find((s) => s.reviewStatus === "pending");
    if (pending) {
      pending.reviewStatus = "changes_requested";
      pending.reviewedBy = user._id;
      pending.reviewedByName = user.name;
      pending.reviewedAt = new Date();
      pending.reviewNote = reason;
    }
    const previous = task.status;
    task.status = activeStatus;
    task.history.push(historyEntry(user, "Changes requested", { from: optionLabel(settings.taskStatuses, previous), to: optionLabel(settings.taskStatuses, activeStatus), note: reason }));
    await task.save();

    await audit(user, { action: "reject", entity: "task", entityId: task._id, ref: task.taskNo, summary: `Requested changes on ${task.taskNo}` });
    await notify(task.assignees, { type: "task", title: `Changes requested: ${task.title}`, body: reason.slice(0, 200), link: `/tasks/${task._id}`, actionable: true, priority: "high" }, [user._id]);
    return null;
  }, "Changes requested");
}
