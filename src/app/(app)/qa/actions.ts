"use server";

import { and, eq, isNull } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can, type CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { resolveFileRefs } from "@/lib/files";
import { db } from "@/lib/db";
import { Issue, newId, PRIORITIES, Project, StoredFile, Task, User, type Id } from "@/lib/models";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { increment, inList, jsonPush, notInList } from "@/lib/sql";
import { statusLabel } from "@/lib/status";
import { todayKey } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { allowedIssueSteps, historyEntry, ISSUE_FLOW, issueCaps, issueFilter, projectCaps, taskFilter, type IssueStep } from "@/lib/work-access";

const SEVERITIES = ["critical", "major", "minor", "trivial"] as const;

const createSchema = z.object({
  project: zs.id("Project"),
  task: zs.optId(),
  title: zs.text("Title", 300),
  description: zs.optText(20000),
  severity: z.enum(SEVERITIES, { error: "Choose a severity" }),
  priority: z.enum(PRIORITIES, { error: "Choose a priority" }),
  stepsToReproduce: zs.optText(10000),
  environment: zs.optText(500),
  attachments: zs.ids(),
  assignee: zs.optId(),
  targetDate: zs.optDate(),
});

/** File refs get an id when embedded (they were sub-documents before), so they can be addressed later. */
const withIds = <T extends { _id?: Id }>(refs: T[]): T[] => refs.map((r) => ({ ...r, _id: r._id ?? newId() }));

async function assertStaff(userId: string, field: string) {
  const count = await db().$count(User, and(eq(User._id, userId), inList(User.personType, ["employee", "trainee", "intern"]), notInList(User.status, EXITED_STATUSES)));
  if (count !== 1) throw new ActionError("Choose an active staff member.", { [field]: "Choose an active staff member" });
}

/** Loads an issue the user may see, plus the project manager and the user's capabilities on it. */
async function loadIssue(user: CurrentUser, id: string) {
  if (!isObjectId(id)) throw new ActionError("Issue not found.");
  const [issue] = await db().select().from(Issue).where(and(eq(Issue._id, id), await issueFilter(user))).limit(1);
  if (!issue) throw new ActionError("Issue not found, or you don't have access to it.");
  const [project] = await db().select({ manager: Project.manager, title: Project.title, projectNo: Project.projectNo }).from(Project).where(eq(Project._id, issue.project)).limit(1);
  return { issue, project, caps: issueCaps(user, issue, project?.manager) };
}

/* ------------------------------------------------------------------ */
/* Create & triage                                                     */
/* ------------------------------------------------------------------ */

export async function createIssue(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(createSchema, input);
    const [project] = await db()
      .select({ _id: Project._id, manager: Project.manager, team: Project.team, title: Project.title, projectNo: Project.projectNo })
      .from(Project)
      .where(eq(Project._id, data.project))
      .limit(1);
    if (!project) throw new ActionError("The project no longer exists.", { project: "Not found" });
    const pcaps = projectCaps(user, project);
    const qaManager = can(user, "qa.manage");
    if ((!qaManager && !pcaps.isManager && !pcaps.isMember) || (!pcaps.view && !can(user, "qa.view_all"))) throw new ActionError("Only the project team and QA managers can report issues on this project.", { project: "Choose one of your projects" });
    const canAssign = qaManager || pcaps.isManager;
    if (data.assignee && !canAssign) throw new ActionError("Only QA managers and the project manager can assign issues.", { assignee: "Not permitted" });
    if (data.assignee) await assertStaff(data.assignee, "assignee");

    if (data.task) {
      const unrestricted = qaManager || can(user, "tasks.view_all");
      const [task] = await db()
        .select({ id: Task._id })
        .from(Task)
        .where(and(eq(Task._id, data.task), eq(Task.project, project._id), unrestricted ? undefined : await taskFilter(user)))
        .limit(1);
      if (!task) throw new ActionError("Choose a task of this project.", { task: "Choose a task of this project" });
    }

    const attachments = await resolveFileRefs(user, data.attachments);
    const issueNo = await nextNumber("issue", ID_PREFIX.issue, 4);
    const [issue] = await db()
      .insert(Issue)
      .values({
        issueNo,
        project: project._id,
        task: data.task,
        title: data.title,
        description: data.description,
        severity: data.severity,
        priority: data.priority,
        stepsToReproduce: data.stepsToReproduce,
        environment: data.environment,
        attachments: withIds(attachments),
        assignee: data.assignee,
        reporter: user._id,
        reportedDate: todayKey(),
        targetDate: data.targetDate,
        status: data.assignee ? "assigned" : "open",
        history: [historyEntry(user, "Issue reported", { to: data.assignee ? "Assigned" : "Open" })],
      })
      .returning();

    // Files were uploaded before the issue existed; bind them to it so the team can download them.
    if (attachments.length > 0) {
      await db()
        .update(StoredFile)
        .set({ entityId: issue._id })
        .where(and(inList(StoredFile._id, attachments.map((a) => a.file)), eq(StoredFile.entityType, "issue"), isNull(StoredFile.entityId)));
    }
    await audit(user, { action: "create", entity: "issue", entityId: issue._id, ref: issueNo, summary: `Reported ${issueNo} (${data.severity}) on ${project.projectNo}: ${issue.title}` });
    const link = `/qa/${issue._id}`;
    if (data.assignee) {
      await notify([data.assignee], { type: "qa", title: `Issue assigned to you: ${issue.title}`, body: `${issueNo} · ${data.severity} · ${project.title}`, link, actionable: true, priority: data.severity === "critical" ? "high" : "normal" }, [user._id]);
    }
    await notify([project.manager], { type: "qa", title: `New ${data.severity} issue: ${issue.title}`, body: `${issueNo} · ${project.title}`, link }, [user._id, data.assignee]);
    return { id: issue._id };
  }, "Issue reported");
}

const triageSchema = z.object({
  severity: z.enum(SEVERITIES, { error: "Choose a severity" }),
  priority: z.enum(PRIORITIES, { error: "Choose a priority" }),
  targetDate: zs.optDate(),
  assignee: zs.optId(),
});

/** Severity, priority, target date and assignment (QA managers and the project manager). */
export async function triageIssue(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(triageSchema, input);
    const { issue, caps } = await loadIssue(user, id);
    if (!caps.manage) throw new ActionError("You don't have permission to triage this issue.");
    if (data.assignee) await assertStaff(data.assignee, "assignee");

    const notes: string[] = [];
    if (issue.severity !== data.severity) notes.push(`Severity ${issue.severity} → ${data.severity}`);
    if (issue.priority !== data.priority) notes.push(`Priority ${issue.priority} → ${data.priority}`);
    if ((issue.targetDate ?? "") !== (data.targetDate ?? "")) notes.push(`Target ${issue.targetDate ?? "none"} → ${data.targetDate ?? "none"}`);
    const previousAssignee = issue.assignee ?? undefined;
    const assigneeChanged = previousAssignee !== data.assignee;

    let status = issue.status;
    if (assigneeChanged) {
      notes.push(data.assignee ? "Reassigned" : "Unassigned");
      // Assignment moves a fresh issue from open → assigned; clearing it returns an untouched one to open.
      if (data.assignee && status === "open") status = "assigned";
      if (!data.assignee && status === "assigned") status = "open";
    }
    if (notes.length === 0) return null;
    await db()
      .update(Issue)
      .set({
        severity: data.severity,
        priority: data.priority,
        targetDate: data.targetDate ?? null,
        assignee: data.assignee ?? null,
        status,
        history: jsonPush(Issue.history, historyEntry(user, assigneeChanged && data.assignee ? "Assigned" : "Issue updated", { note: notes.join(" · ") })),
      })
      .where(eq(Issue._id, issue._id));

    await audit(user, { action: assigneeChanged ? "assign" : "update", entity: "issue", entityId: issue._id, ref: issue.issueNo, summary: `Triaged ${issue.issueNo}: ${notes.join("; ")}` });
    if (assigneeChanged && data.assignee) {
      await notify([data.assignee], { type: "qa", title: `Issue assigned to you: ${issue.title}`, body: `${issue.issueNo} · ${data.severity}`, link: `/qa/${issue._id}`, actionable: true }, [user._id]);
    }
    if (assigneeChanged && previousAssignee) {
      await notify([previousAssignee], { type: "qa", title: `Issue reassigned: ${issue.title}`, body: issue.issueNo, link: `/qa/${issue._id}` }, [user._id]);
    }
    return null;
  }, "Issue updated");
}

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

/**
 * Moves an issue along open → assigned → in progress → fixed → ready for testing → verified → closed
 * (reopen is possible from fixed onwards). Who may take each step is enforced here.
 */
async function transition(id: string, step: IssueStep, extra: { resolution?: string; note?: string } = {}) {
  const user = await actionUser();
  const { issue, project, caps } = await loadIssue(user, id);
  const rule = ISSUE_FLOW[step];
  if (!rule.from.includes(issue.status)) {
    throw new ActionError(`This issue is ${statusLabel("issue", issue.status).toLowerCase()}, so that step isn't available.`);
  }
  if (!allowedIssueSteps(user, caps, issue).includes(step)) {
    if ((step === "verify" || step === "close") && caps.isAssignee) throw new ActionError("You can't verify or close your own fix. Ask QA to do it.");
    if ((step === "start" || step === "fix") && !issue.assignee) throw new ActionError("Assign the issue to someone first.");
    throw new ActionError("You don't have permission to do this.");
  }

  const previous = issue.status;
  const patch: SQLiteUpdateSetSource<typeof Issue> = { status: rule.to };
  if (step === "fix") {
    patch.resolution = extra.resolution ?? null;
    patch.resolvedAt = new Date();
  }
  if (step === "verify") patch.verifiedBy = user._id;
  if (step === "close") patch.closedAt = new Date();
  if (step === "reopen") {
    patch.reopenCount = increment(Issue.reopenCount, 1);
    patch.resolvedAt = null;
    patch.closedAt = null;
    patch.verifiedBy = null;
  }
  patch.history = jsonPush(Issue.history, historyEntry(user, rule.label, { from: statusLabel("issue", previous), to: statusLabel("issue", rule.to), note: extra.resolution ?? extra.note }));
  await db().update(Issue).set(patch).where(eq(Issue._id, issue._id));

  await audit(user, { action: "status", entity: "issue", entityId: issue._id, ref: issue.issueNo, summary: `${issue.issueNo}: ${statusLabel("issue", previous)} → ${statusLabel("issue", rule.to)}` });
  const title = `${issue.issueNo} ${rule.label.toLowerCase()}: ${issue.title}`;
  const body = extra.resolution ?? extra.note ?? undefined;
  const link = `/qa/${issue._id}`;
  const needsAssignee = step === "reopen" || step === "verify";
  if (step === "fix" || step === "ready") {
    await notify([issue.reporter, project?.manager], { type: "qa", title, body, link, actionable: step === "ready" }, [user._id]);
  } else {
    await notify([issue.assignee, issue.reporter, needsAssignee ? project?.manager : undefined], { type: "qa", title, body, link, actionable: step === "reopen", priority: step === "reopen" ? "high" : "normal" }, [user._id]);
  }
}

export async function startIssue(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await transition(id, "start");
    return null;
  }, "Work started");
}

export async function markIssueFixed(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const data = parse(z.object({ resolution: zs.text("Resolution", 5000) }), input);
    await transition(id, "fix", { resolution: data.resolution });
    return null;
  }, "Marked as fixed");
}

export async function markReadyForTesting(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await transition(id, "ready");
    return null;
  }, "Ready for testing");
}

export async function verifyIssue(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await transition(id, "verify");
    return null;
  }, "Fix verified");
}

export async function closeIssue(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await transition(id, "close");
    return null;
  }, "Issue closed");
}

export async function reopenIssue(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const note = parse(zs.text("Reason", 2000), reason);
    await transition(id, "reopen", { note });
    return null;
  }, "Issue reopened");
}

/* ------------------------------------------------------------------ */
/* Comments & attachments                                              */
/* ------------------------------------------------------------------ */

export async function addIssueComment(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ text: zs.text("Comment", 5000), attachments: zs.ids() }), input);
    const { issue, project } = await loadIssue(user, id);
    const attachments = await resolveFileRefs(user, data.attachments);
    await db()
      .update(Issue)
      .set({ comments: jsonPush(Issue.comments, { _id: newId(), user: user._id, userName: user.name, text: data.text, attachments: withIds(attachments), at: new Date() }) })
      .where(eq(Issue._id, issue._id));
    await notify([issue.assignee, issue.reporter, project?.manager], { type: "qa", title: `${user.name} commented on ${issue.issueNo}`, body: data.text.slice(0, 200), link: `/qa/${issue._id}` }, [user._id]);
    return null;
  }, "Comment added");
}

export async function addIssueAttachments(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ attachments: zs.ids() }), input);
    const { issue, caps } = await loadIssue(user, id);
    if (!caps.manage && !caps.isReporter && !caps.isAssignee) throw new ActionError("You can't attach files to this issue.");
    const files = await resolveFileRefs(user, data.attachments);
    if (files.length === 0) throw new ActionError("Choose at least one file to attach.");
    await db()
      .update(Issue)
      .set({
        attachments: jsonPush(Issue.attachments, ...withIds(files)),
        history: jsonPush(Issue.history, historyEntry(user, "Files attached", { note: files.map((f) => f.name).join(", ") })),
      })
      .where(eq(Issue._id, issue._id));
    return null;
  }, "Files attached");
}
