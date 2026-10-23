"use server";

import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can, type CurrentUser } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { resolveFileRefs } from "@/lib/files";
import { Client, Contract, Expense, Invoice, Issue, PRIORITIES, Project, Proposal, Task, TimesheetEntry, Types, User, type ObjectId } from "@/lib/models";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { optionLabel, statusLabel } from "@/lib/status";
import { todayKey } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { adviseRotationForRemoved, shredProjectVault } from "@/lib/vault/service";
import { canSeeClient, categoryOf, firstInCategory, historyEntry, keysInCategories, projectCaps, TASK_CLOSED_CATEGORIES } from "@/lib/work-access";

const MILESTONE_FLOW = ["pending", "in_progress", "client_review", "approved", "delivered"] as const;
const MILESTONE_STATUSES = [...MILESTONE_FLOW, "delayed"] as const;

const teamField = z.preprocess(
  (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v !== "string" || !v.trim()) return [];
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  },
  z.array(z.object({ user: zs.id("Team member"), role: zs.optText(100), allocation: zs.num("Allocation", { min: 0, max: 100 }) }), { error: "Invalid team" }),
);

const projectSchema = z.object({
  title: zs.text("Title", 200),
  internal: zs.bool(),
  client: zs.optId(),
  description: zs.optText(20000),
  scope: zs.optText(20000),
  deliverables: z.preprocess(
    (v) =>
      String(v ?? "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean),
    z.array(z.string().max(300, "Each deliverable must be under 300 characters")),
  ),
  manager: zs.optId(),
  team: teamField,
  startDate: zs.optDate(),
  targetDate: zs.optDate(),
  budget: zs.optNum({ min: 0 }),
  estimatedHours: zs.optNum({ min: 0, max: 1_000_000 }),
  priority: z.enum(PRIORITIES, { error: "Choose a priority" }),
  status: zs.text("Status", 60),
  proposal: zs.optId(),
  contract: zs.optId(),
});

type ProjectInput = z.infer<typeof projectSchema>;

/** Loads a project and checks the user's capability on it. */
async function loadProject(user: CurrentUser, id: string, need: "view" | "manage") {
  if (!isObjectId(id)) throw new ActionError("Project not found.");
  const project = await Project.findById(id);
  if (!project) throw new ActionError("Project not found.");
  const caps = projectCaps(user, project);
  if (!caps.view) throw new ActionError("Project not found, or you don't have access to it.");
  if (need === "manage" && !caps.manage) throw new ActionError("You don't have permission to change this project.");
  return { project, caps };
}

function teamRecipients(project: { manager?: ObjectId | null; team: { user: ObjectId }[] }): (ObjectId | null | undefined)[] {
  return [project.manager, ...project.team.map((m) => m.user)];
}

async function assertStaff(userIds: string[], field: string) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const count = await User.countDocuments({ _id: { $in: unique }, personType: { $in: ["employee", "trainee", "intern"] }, status: { $nin: EXITED_STATUSES } });
  if (count !== unique.length) throw new ActionError("Choose active staff members only.", { [field]: "Choose active staff members only." });
}

/** Cross-field and reference checks shared by create and update. */
async function validateProjectInput(user: CurrentUser, data: ProjectInput, existing?: { client?: ObjectId | null; proposal?: ObjectId | null; contract?: ObjectId | null }) {
  const settings = await getSettings();
  if (!settings.projectStatuses.some((s) => s.key === data.status)) throw new ActionError("Choose a valid status.", { status: "Choose a valid status" });
  if (data.startDate && data.targetDate && data.targetDate < data.startDate) {
    throw new ActionError("The target date is before the start date.", { targetDate: "Must be on or after the start date" });
  }
  if (!data.internal && !data.client) throw new ActionError("Choose a client, or mark the project as internal.", { client: "Choose a client or mark as internal" });
  if (data.manager) await assertStaff([data.manager], "manager");
  const teamIds = data.team.map((m) => m.user);
  if (new Set(teamIds).size !== teamIds.length) throw new ActionError("A person is listed twice in the team.", { team: "Each person can be added once" });
  await assertStaff(teamIds, "team");

  let clientId = data.internal ? undefined : data.client;
  if (clientId && clientId !== existing?.client?.toString()) {
    const client = await Client.findById(clientId, { confidential: 1, owner: 1 }).lean();
    if (!client || !canSeeClient(user, client)) throw new ActionError("Choose a valid client.", { client: "Choose a valid client" });
  }
  // A restricted client the editor can't see is preserved rather than silently dropped.
  if (!data.internal && !clientId) clientId = existing?.client?.toString();

  if (data.proposal && data.proposal !== existing?.proposal?.toString()) {
    const p = await Proposal.findById(data.proposal, { client: 1 }).lean();
    if (!p || !can(user, "proposals.view")) throw new ActionError("Choose a valid proposal.", { proposal: "Choose a valid proposal" });
    if (clientId && p.client.toString() !== clientId) throw new ActionError("That proposal belongs to a different client.", { proposal: "Different client" });
  }
  if (data.contract && data.contract !== existing?.contract?.toString()) {
    const c = await Contract.findById(data.contract, { client: 1 }).lean();
    if (!c || !can(user, "contracts.view")) throw new ActionError("Choose a valid contract.", { contract: "Choose a valid contract" });
    if (clientId && c.client.toString() !== clientId) throw new ActionError("That contract belongs to a different client.", { contract: "Different client" });
  }
  return { settings, clientId };
}

/* ------------------------------------------------------------------ */
/* Project create / update / status / delete                           */
/* ------------------------------------------------------------------ */

export async function createProject(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!can(user, "projects.manage")) throw new ActionError("You don't have permission to create projects.");
    const data = parse(projectSchema, input);
    const { settings, clientId } = await validateProjectInput(user, data);

    const projectNo = await nextNumber("project", ID_PREFIX.project, 4);
    const completed = categoryOf(settings.projectStatuses, data.status) === "completed";
    const project = await Project.create({
      projectNo,
      title: data.title,
      client: clientId,
      internal: data.internal,
      description: data.description,
      scope: data.scope,
      deliverables: data.deliverables,
      manager: data.manager,
      team: data.team.map((m) => ({ user: m.user, role: m.role, allocation: m.allocation })),
      startDate: data.startDate,
      targetDate: data.targetDate,
      completedDate: completed ? todayKey() : undefined,
      budget: can(user, "projects.financials") ? (data.budget ?? 0) : 0,
      estimatedHours: data.estimatedHours ?? 0,
      priority: data.priority,
      status: data.status,
      proposal: data.proposal,
      contract: data.contract,
      createdBy: user._id,
      history: [historyEntry(user, "Project created", { to: optionLabel(settings.projectStatuses, data.status) })],
    });

    await audit(user, { action: "create", entity: "project", entityId: project._id, ref: projectNo, summary: `Created project ${projectNo}: ${project.title}` });
    await notify(
      [data.manager, ...data.team.map((m) => m.user)],
      { type: "project", title: `You were added to project ${projectNo}`, body: project.title, link: `/projects/${project._id}` },
      [user._id],
    );
    return { id: project._id.toString() };
  }, "Project created");
}

export async function updateProject(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project, caps } = await loadProject(user, id, "manage");
    const data = parse(projectSchema, input);
    const { settings, clientId } = await validateProjectInput(user, data, project);

    const previousStatus = project.status;
    const statusChanged = data.status !== previousStatus;
    if (statusChanged && categoryOf(settings.projectStatuses, data.status) === "cancelled" && !can(user, "projects.delete")) {
      throw new ActionError("Only users who can cancel projects may set a cancelled status.", { status: "Not permitted" });
    }
    const previousManager = project.manager?.toString();
    const previousPeople = [previousManager, ...project.team.map((m) => m.user.toString())].filter(Boolean) as string[];
    // Vault access follows membership: `projects.manage` alone must not let someone put themselves on the team.
    if (!user.isSuperAdmin && !caps.isManager) {
      if (data.manager === user.id && previousManager !== user.id) {
        throw new ActionError("You can't make yourself the project manager. Ask the current manager or an administrator.", { manager: "Not permitted" });
      }
      if (data.team.some((m) => m.user === user.id) && !caps.isMember) {
        throw new ActionError("You can't add yourself to the project team. Ask the project manager or an administrator.", { team: "Not permitted" });
      }
    }
    const before = {
      title: project.title,
      client: project.client?.toString(),
      internal: project.internal,
      description: project.description,
      scope: project.scope,
      deliverables: project.deliverables.join("\n"),
      manager: project.manager?.toString(),
      team: project.team.map((m) => `${m.user}:${m.role ?? ""}:${m.allocation}`).join(","),
      startDate: project.startDate,
      targetDate: project.targetDate,
      budget: project.budget,
      estimatedHours: project.estimatedHours,
      priority: project.priority,
      proposal: project.proposal?.toString(),
      contract: project.contract?.toString(),
    };
    const budget = caps.financials ? (data.budget ?? 0) : project.budget;
    const after = {
      title: data.title,
      client: clientId,
      internal: data.internal,
      description: data.description,
      scope: data.scope,
      deliverables: data.deliverables.join("\n"),
      manager: data.manager,
      team: data.team.map((m) => `${m.user}:${m.role ?? ""}:${m.allocation}`).join(","),
      startDate: data.startDate,
      targetDate: data.targetDate,
      budget,
      estimatedHours: data.estimatedHours ?? 0,
      priority: data.priority,
      proposal: data.proposal ?? (can(user, "proposals.view") ? undefined : project.proposal?.toString()),
      contract: data.contract ?? (can(user, "contracts.view") ? undefined : project.contract?.toString()),
    };
    const changes = diff(before, after, ["title", "client", "internal", "description", "scope", "deliverables", "manager", "team", "startDate", "targetDate", "budget", "estimatedHours", "priority", "proposal", "contract"], ["budget"]);

    project.title = data.title;
    project.set("client", clientId);
    project.internal = data.internal;
    project.description = data.description;
    project.scope = data.scope;
    project.set("deliverables", data.deliverables);
    project.set("manager", data.manager);
    project.set("team", data.team.map((m) => ({ user: m.user, role: m.role, allocation: m.allocation })));
    project.startDate = data.startDate;
    project.targetDate = data.targetDate;
    project.budget = budget;
    project.estimatedHours = data.estimatedHours ?? 0;
    project.priority = data.priority;
    project.set("proposal", after.proposal);
    project.set("contract", after.contract);

    if (changes.length === 0 && !statusChanged) return { id };
    if (changes.length) project.history.push(historyEntry(user, "Project updated", { note: changes.map((c) => c.field).join(", ") }));
    if (statusChanged) {
      project.status = data.status;
      const cat = categoryOf(settings.projectStatuses, data.status);
      project.completedDate = cat === "completed" ? todayKey() : undefined;
      project.history.push(historyEntry(user, "Status changed", { from: optionLabel(settings.projectStatuses, previousStatus), to: optionLabel(settings.projectStatuses, data.status) }));
    }
    await project.save();

    await audit(user, { action: "update", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Updated project ${project.projectNo}`, changes: [...changes, ...(statusChanged ? [{ field: "status", from: previousStatus, to: data.status }] : [])] });
    const nowPeople = [data.manager, ...data.team.map((m) => m.user)].filter(Boolean) as string[];
    await adviseRotationForRemoved(project._id, previousPeople.filter((p) => !nowPeople.includes(p)), "Someone who accessed it left the project team");
    if (previousManager && data.manager !== previousManager && nowPeople.includes(previousManager)) {
      // Owner → member: they keep team-level items but lose the owner's view of every item.
      await adviseRotationForRemoved(project._id, [previousManager], "The previous project manager is now a team member");
    }
    await notify(nowPeople.filter((p) => !previousPeople.includes(p)), { type: "project", title: `You were added to project ${project.projectNo}`, body: project.title, link: `/projects/${project._id}` }, [user._id]);
    if (changes.some((c) => c.field === "manager" || c.field === "team")) {
      await notify(
        [previousManager, data.manager],
        { type: "project", title: `Team changed on ${project.projectNo}`, body: `${user.name} changed the ${changes.some((c) => c.field === "manager") ? "manager" : "team"} of ${project.title}.`, link: `/projects/${project._id}?tab=team` },
        [user._id],
      );
    }
    if (statusChanged) {
      await notify(teamRecipients(project), { type: "project", title: `${project.projectNo} is now ${optionLabel(settings.projectStatuses, data.status)}`, body: project.title, link: `/projects/${project._id}` }, [user._id]);
    }
    return { id };
  }, "Project saved");
}

export async function setProjectStatus(id: string, status: string, rawNote?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const note = parse(zs.optText(1000), rawNote);
    const { project } = await loadProject(user, id, "manage");
    const settings = await getSettings();
    if (!settings.projectStatuses.some((s) => s.key === status)) throw new ActionError("Unknown status.");
    if (status === project.status) return null;
    const cat = categoryOf(settings.projectStatuses, status);
    if (cat === "cancelled" && !can(user, "projects.delete")) throw new ActionError("Only users who can cancel projects may do this. Ask an administrator.");
    const previous = project.status;
    project.status = status;
    project.completedDate = cat === "completed" ? todayKey() : undefined;
    project.history.push(historyEntry(user, "Status changed", { from: optionLabel(settings.projectStatuses, previous), to: optionLabel(settings.projectStatuses, status), note: note?.trim() || undefined }));
    await project.save();
    await audit(user, { action: "status", entity: "project", entityId: project._id, ref: project.projectNo, summary: `${project.projectNo}: ${optionLabel(settings.projectStatuses, previous)} → ${optionLabel(settings.projectStatuses, status)}` });
    await notify(teamRecipients(project), { type: "project", title: `${project.projectNo} is now ${optionLabel(settings.projectStatuses, status)}`, body: note?.trim() || project.title, link: `/projects/${project._id}` }, [user._id]);
    return null;
  }, "Status updated");
}

/** "Cancel project": the safe alternative to deleting a project that already has work against it. */
export async function cancelProject(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!can(user, "projects.delete")) throw new ActionError("You don't have permission to cancel projects.");
    const why = parse(zs.text("Reason", 1000), reason);
    const { project } = await loadProject(user, id, "view");
    const settings = await getSettings();
    const cancelled = firstInCategory(settings.projectStatuses, "cancelled");
    if (!cancelled) throw new ActionError("No cancelled status is configured. Ask an administrator to add one.");
    if (project.status === cancelled) throw new ActionError("This project is already cancelled.");
    const previous = project.status;
    project.status = cancelled;
    project.completedDate = undefined;
    project.history.push(historyEntry(user, "Project cancelled", { from: optionLabel(settings.projectStatuses, previous), to: optionLabel(settings.projectStatuses, cancelled), note: why }));
    await project.save();
    await audit(user, { action: "cancel", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Cancelled project ${project.projectNo}: ${why}` });
    await notify(teamRecipients(project), { type: "project", title: `Project cancelled: ${project.projectNo}`, body: why, link: `/projects/${project._id}`, priority: "high" }, [user._id]);
    return null;
  }, "Project cancelled");
}

export async function deleteProject(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!can(user, "projects.delete")) throw new ActionError("You don't have permission to delete projects.");
    const { project } = await loadProject(user, id, "view");
    const [tasks, entries, issues, invoices, expenses] = await Promise.all([
      Task.countDocuments({ project: project._id }),
      TimesheetEntry.countDocuments({ project: project._id }),
      Issue.countDocuments({ project: project._id }),
      Invoice.countDocuments({ project: project._id }),
      Expense.countDocuments({ project: project._id }),
    ]);
    const blockers = [
      tasks && `${tasks} ${tasks === 1 ? "task" : "tasks"}`,
      entries && `${entries} timesheet ${entries === 1 ? "entry" : "entries"}`,
      issues && `${issues} QA ${issues === 1 ? "issue" : "issues"}`,
      invoices && `${invoices} ${invoices === 1 ? "invoice" : "invoices"}`,
      expenses && `${expenses} ${expenses === 1 ? "expense" : "expenses"}`,
    ].filter(Boolean);
    if (blockers.length) throw new ActionError(`This project has ${blockers.join(", ")} and can't be deleted. Cancel it instead.`);
    await project.deleteOne();
    const shredded = await shredProjectVault(project._id);
    await audit(user, { action: "delete", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Deleted project ${project.projectNo}: ${project.title}${shredded ? ` (${shredded} secret${shredded === 1 ? "" : "s"} and the vault access log shredded)` : ""}` });
    return null;
  }, "Project deleted");
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

const milestoneSchema = z.object({
  title: zs.text("Title", 200),
  description: zs.optText(2000),
  dueDate: zs.optDate(),
  amount: zs.optNum({ min: 0 }),
  status: z.enum(MILESTONE_STATUSES, { error: "Choose a status" }),
  deliveredAt: zs.optDate(),
  clientReviewNote: zs.optText(2000),
  approvedBy: zs.optText(200),
  releaseNotes: zs.optText(5000),
});

const MILESTONE_LABEL = (s: string) => statusLabel("milestone", s);

/** Creates (no `milestoneId`) or edits a milestone. */
export async function saveMilestone(projectId: string, milestoneId: string | undefined, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project, caps } = await loadProject(user, projectId, "manage");
    const data = parse(milestoneSchema, input);
    const existing = milestoneId ? project.milestones.find((m) => m._id.toString() === milestoneId) : undefined;
    if (milestoneId && !existing) throw new ActionError("That milestone no longer exists.");
    if (data.status === "delayed" && existing?.status !== "delayed") {
      throw new ActionError("Overdue milestones are marked delayed automatically.", { status: "Choose another status" });
    }
    const today = todayKey();
    // Re-planning an overdue milestone to a future date lifts the delayed flag.
    let status = data.status;
    if (status === "delayed" && data.dueDate && data.dueDate >= today) status = "in_progress";
    if (status === "delivered" && !data.deliveredAt) data.deliveredAt = today;

    const fields = {
      title: data.title,
      description: data.description,
      dueDate: data.dueDate,
      status,
      deliveredAt: status === "delivered" ? data.deliveredAt : undefined,
      clientReviewNote: data.clientReviewNote,
      releaseNotes: data.releaseNotes,
      approvedBy: status === "approved" || status === "delivered" ? (data.approvedBy ?? existing?.approvedBy ?? user.name) : data.approvedBy,
      amount: caps.financials ? data.amount : existing?.amount,
    };

    if (existing) {
      const previous = existing.status;
      const becameApproved = (status === "approved" || status === "delivered") && !existing.approvedAt;
      Object.assign(existing, fields);
      if (becameApproved) existing.approvedAt = new Date();
      if (previous !== status) project.history.push(historyEntry(user, `Milestone “${data.title}”`, { from: MILESTONE_LABEL(previous), to: MILESTONE_LABEL(status) }));
      else project.history.push(historyEntry(user, `Milestone “${data.title}” updated`));
      await project.save();
      await audit(user, { action: "update", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Updated milestone “${data.title}” on ${project.projectNo}${previous !== status ? ` (${MILESTONE_LABEL(previous)} → ${MILESTONE_LABEL(status)})` : ""}` });
      if (previous !== status) {
        await notify(teamRecipients(project), { type: "project", title: `Milestone ${MILESTONE_LABEL(status).toLowerCase()}: ${data.title}`, body: `${project.projectNo} · ${project.title}`, link: `/projects/${project._id}?tab=milestones` }, [user._id]);
      }
    } else {
      project.milestones.push({ _id: new Types.ObjectId(), ...fields, amount: caps.financials ? data.amount : undefined, invoiced: false, approvedAt: status === "approved" || status === "delivered" ? new Date() : undefined });
      project.history.push(historyEntry(user, `Milestone “${data.title}” added`, { to: data.dueDate }));
      await project.save();
      await audit(user, { action: "create", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Added milestone “${data.title}” to ${project.projectNo}` });
    }
    return null;
  }, "Milestone saved");
}

/** Moves a milestone one step forward in pending → in progress → client review → approved → delivered. */
export async function advanceMilestone(projectId: string, milestoneId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project } = await loadProject(user, projectId, "manage");
    const m = project.milestones.find((x) => x._id.toString() === milestoneId);
    if (!m) throw new ActionError("That milestone no longer exists.");
    const index = (MILESTONE_FLOW as readonly string[]).indexOf(m.status);
    // A delayed milestone resumes at "in progress".
    const next = m.status === "delayed" ? "in_progress" : MILESTONE_FLOW[index + 1];
    if (!next) throw new ActionError("This milestone is already delivered.");
    const previous = m.status;
    m.status = next;
    if (next === "approved" && !m.approvedAt) {
      m.approvedAt = new Date();
      m.approvedBy = m.approvedBy ?? user.name;
    }
    if (next === "delivered") m.deliveredAt = todayKey();
    project.history.push(historyEntry(user, `Milestone “${m.title}”`, { from: MILESTONE_LABEL(previous), to: MILESTONE_LABEL(next) }));
    await project.save();
    await audit(user, { action: "status", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Milestone “${m.title}” on ${project.projectNo}: ${MILESTONE_LABEL(previous)} → ${MILESTONE_LABEL(next)}` });
    await notify(teamRecipients(project), { type: "project", title: `Milestone ${MILESTONE_LABEL(next).toLowerCase()}: ${m.title}`, body: `${project.projectNo} · ${project.title}`, link: `/projects/${project._id}?tab=milestones` }, [user._id]);
    return null;
  }, "Milestone updated");
}

export async function deleteMilestone(projectId: string, milestoneId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project } = await loadProject(user, projectId, "manage");
    const m = project.milestones.find((x) => x._id.toString() === milestoneId);
    if (!m) throw new ActionError("That milestone no longer exists.");
    if (m.invoiced) throw new ActionError("This milestone has been invoiced and can't be deleted.");
    const linked = await Task.countDocuments({ project: project._id, milestone: m._id });
    if (linked) throw new ActionError(`${linked} ${linked === 1 ? "task is" : "tasks are"} linked to this milestone. Move them first.`);
    const title = m.title;
    project.set("milestones", project.milestones.filter((x) => x._id.toString() !== milestoneId));
    project.history.push(historyEntry(user, `Milestone “${title}” removed`));
    await project.save();
    await audit(user, { action: "delete", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Removed milestone “${title}” from ${project.projectNo}` });
    return null;
  }, "Milestone removed");
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

const memberSchema = z.object({ user: zs.id("Person"), role: zs.optText(100), allocation: zs.num("Allocation", { min: 0, max: 100 }) });

/** Adds a team member, or updates the role / allocation of an existing one. */
export async function saveTeamMember(projectId: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const { project, caps } = await loadProject(actor, projectId, "manage");
    const data = parse(memberSchema, input);
    await assertStaff([data.user], "user");
    const existing = project.team.find((m) => m.user.toString() === data.user);
    // Vault access follows membership: `projects.manage` alone must not let someone put themselves on the team.
    if (!existing && data.user === actor.id && !actor.isSuperAdmin && !caps.isManager) {
      throw new ActionError("You can't add yourself to the project team. Ask the project manager or an administrator.", { user: "Not permitted" });
    }
    const person = await User.findById(data.user, { name: 1 }).lean();
    if (existing) {
      existing.role = data.role;
      existing.allocation = data.allocation;
    } else {
      project.team.push({ user: new Types.ObjectId(data.user), role: data.role, allocation: data.allocation });
    }
    project.history.push(historyEntry(actor, existing ? "Team member updated" : "Team member added", { note: `${data.role ?? "Member"} · ${data.allocation}%` }));
    await project.save();
    await audit(actor, { action: "assign", entity: "project", entityId: project._id, ref: project.projectNo, summary: `${existing ? "Updated" : "Added"} ${person?.name ?? "a team member"} on ${project.projectNo} (${data.role ?? "Member"}, ${data.allocation}% allocation)` });
    if (!existing) await notify([data.user], { type: "project", title: `You were added to project ${project.projectNo}`, body: project.title, link: `/projects/${project._id}` }, [actor._id]);
    await notify(
      [project.manager],
      { type: "project", title: `Team changed on ${project.projectNo}`, body: `${actor.name} ${existing ? "updated" : "added"} ${person?.name ?? "a team member"} (${data.allocation}%).`, link: `/projects/${project._id}?tab=team` },
      [actor._id, data.user],
    );
    return null;
  }, "Team updated");
}

export async function removeTeamMember(projectId: string, userId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionUser();
    const { project } = await loadProject(actor, projectId, "manage");
    const member = project.team.find((m) => m.user.toString() === userId);
    if (!member) throw new ActionError("That person is not on the team.");
    const settings = await getSettings();
    const open = await Task.countDocuments({ project: project._id, assignees: member.user, status: { $nin: keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES) } });
    if (open) throw new ActionError(`They still have ${open} open ${open === 1 ? "task" : "tasks"} in this project. Reassign them first.`);
    project.set("team", project.team.filter((m) => m.user.toString() !== userId));
    project.history.push(historyEntry(actor, "Team member removed"));
    await project.save();
    const removed = await User.findById(userId, { name: 1 }).lean();
    const removedName = removed?.name ?? "A team member";
    if (project.manager?.toString() !== userId) {
      await adviseRotationForRemoved(project._id, [userId], `${removedName} was removed from the team after accessing it`);
    }
    await audit(actor, { action: "assign", entity: "project", entityId: project._id, ref: project.projectNo, summary: `Removed ${removedName} from ${project.projectNo}` });
    await notify([userId], { type: "project", title: `You were removed from project ${project.projectNo}`, body: project.title }, [actor._id]);
    await notify([project.manager], { type: "project", title: `Team changed on ${project.projectNo}`, body: `${actor.name} removed ${removedName} from ${project.title}.`, link: `/projects/${project._id}?tab=team` }, [actor._id, userId]);
    return null;
  }, "Team member removed");
}

/* ------------------------------------------------------------------ */
/* Comments and files                                                  */
/* ------------------------------------------------------------------ */

export async function addProjectComment(projectId: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ text: zs.text("Comment", 5000), attachments: zs.ids() }), input);
    const { project } = await loadProject(user, projectId, "view");
    const attachments = await resolveFileRefs(user, data.attachments);
    project.comments.push({ user: user._id, userName: user.name, text: data.text, attachments, at: new Date() });
    await project.save();
    await notify(teamRecipients(project), { type: "project", title: `${user.name} commented on ${project.projectNo}`, body: data.text.slice(0, 200), link: `/projects/${project._id}?tab=activity` }, [user._id]);
    return null;
  }, "Comment added");
}

export async function addProjectFiles(projectId: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(z.object({ attachments: zs.ids() }), input);
    const { project } = await loadProject(user, projectId, "view");
    const files = await resolveFileRefs(user, data.attachments);
    if (files.length === 0) throw new ActionError("Choose at least one file to attach.");
    project.attachments.push(...files);
    project.history.push(historyEntry(user, "Files attached", { note: files.map((f) => f.name).join(", ") }));
    await project.save();
    return null;
  }, "Files attached");
}

export async function removeProjectFile(projectId: string, refId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project, caps } = await loadProject(user, projectId, "view");
    const ref = project.attachments.find((a) => a._id?.toString() === refId);
    if (!ref) throw new ActionError("That file no longer exists.");
    if (!caps.manage && ref.uploadedBy?.toString() !== user.id) throw new ActionError("You can only remove files you uploaded.");
    const name = ref.name;
    project.set("attachments", project.attachments.filter((a) => a._id?.toString() !== refId));
    project.history.push(historyEntry(user, "File removed", { note: name }));
    await project.save();
    return null;
  }, "File removed");
}
