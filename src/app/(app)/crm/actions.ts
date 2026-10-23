"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { db } from "@/lib/db";
import { Activity, Client, Lead, newId, Proposal, StoredFile, User, type FileRef, type Id, type ILead } from "@/lib/models";
import { resolveFileRefs } from "@/lib/files";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES, namesFor } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { jsonPush } from "@/lib/sql";
import { fmtDateTime, parseLocalDateTime } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { actionClient, actionLead } from "./_lib/access";
import { findDuplicates, type DuplicateReport } from "./_lib/duplicates";
import { closeLeadWon, closePendingFollowUps, historyEntry, refreshNextFollowUp, setOpenStage } from "./_lib/leads";
import { firstStageOf, stageByKey } from "./_lib/pipeline";

export type LeadSaveResult = { id: string } | { duplicates: DuplicateReport };

/* ------------------------------------------------------------------ helpers */

/** Lead assignees must be active employees: interns and trainees never see client data (FRS §3.2). */
async function assertPerson(id: string | undefined): Promise<Id | undefined> {
  if (!id) return undefined;
  const [user] = await db().select({ _id: User._id, personType: User.personType, status: User.status }).from(User).where(eq(User._id, id)).limit(1);
  if (!user) throw new ActionError("The selected person no longer exists.");
  if (user.personType !== "employee" || EXITED_STATUSES.includes(user.status)) throw new ActionError("Choose an active employee.", { assignedTo: "Choose an active employee" });
  return user._id;
}

function assertPhone(phone: string | undefined): void {
  if (phone && phone.replace(/\D/g, "").length < 7) throw new ActionError("Enter a valid phone number.", { phone: "Enter a valid phone number" });
}

/* ------------------------------------------------------------------- leads */

const leadFields = {
  title: zs.text("Title", 200),
  client: zs.optId(),
  companyName: zs.optText(200),
  contactName: zs.optText(200),
  email: zs.optEmail(),
  phone: zs.optText(40),
  requirement: zs.optText(5000),
  budget: zs.optNum({ min: 0 }),
  expectedValue: zs.optNum({ min: 0 }),
  source: zs.optText(100),
  assignedTo: zs.optId(),
  nextFollowUp: zs.optDateTime(),
  expectedCloseDate: zs.optDate(),
};

const createLeadSchema = z.object({ ...leadFields, stage: zs.text("Stage", 60), confirmDuplicates: zs.bool() });
const updateLeadSchema = z.object(leadFields);

export async function createLead(input: Record<string, unknown>): Promise<ActionResult<LeadSaveResult>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    const data = parse(createLeadSchema, input);
    const settings = await getSettings();
    const stage = stageByKey(settings.pipelineStages, data.stage);
    if (!stage || stage.category !== "open") throw new ActionError("Choose an open pipeline stage.", { stage: "Choose an open stage" });

    const client = data.client ? await actionClient(user, data.client) : null;
    const companyName = client?.name ?? data.companyName;
    if (!companyName) throw new ActionError("Choose a client or enter a company name.", { companyName: "Company name is required" });
    assertPhone(data.phone);
    const assignedTo = await assertPerson(data.assignedTo ?? user.id);

    if (!data.confirmDuplicates) {
      const report = await findDuplicates(user, { email: data.email, phone: data.phone, companyName, includeClients: !client });
      if (report.matches.length > 0 || report.restricted > 0) return { duplicates: report };
    }

    const leadNo = await nextNumber("lead", ID_PREFIX.lead, 4);
    const [lead] = await db()
      .insert(Lead)
      .values({
        leadNo,
        title: data.title,
        client: client?._id,
        companyName,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        requirement: data.requirement,
        budget: data.budget,
        expectedValue: data.expectedValue,
        source: data.source,
        assignedTo,
        stage: stage.key,
        status: "open",
        nextFollowUp: parseLocalDateTime(data.nextFollowUp) ?? undefined,
        expectedCloseDate: data.expectedCloseDate,
        history: [historyEntry(user, "created", { to: stage.key })],
        createdBy: user._id,
      })
      .returning();
    await audit(user, { action: "create", entity: "lead", entityId: lead._id, ref: leadNo, summary: `Created lead ${leadNo}: ${lead.title} (${companyName})` });
    await notify([assignedTo], { type: "crm", title: `New lead assigned: ${lead.title}`, body: companyName, link: `/crm/leads/${lead._id}`, actionable: true }, [user._id]);
    return { id: lead._id };
  });
}

export async function updateLead(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    await actionLead(user, id);
    const data = parse(updateLeadSchema, input);
    const [lead] = await db().select().from(Lead).where(eq(Lead._id, id)).limit(1);
    if (!lead) throw new ActionError("This lead no longer exists.");
    assertPhone(data.phone);
    const assignedTo = await assertPerson(data.assignedTo);

    const snapshot = (l: ILead) => ({
      title: l.title,
      client: l.client,
      companyName: l.companyName,
      contactName: l.contactName,
      email: l.email,
      phone: l.phone,
      requirement: l.requirement,
      budget: l.budget,
      expectedValue: l.expectedValue,
      source: l.source,
      assignedTo: l.assignedTo,
      nextFollowUp: l.nextFollowUp,
      expectedCloseDate: l.expectedCloseDate,
    });
    const before = snapshot(lead);

    // The client can only change while the lead is open and has no proposal attached.
    let clientId = lead.client;
    if (data.client !== (lead.client ?? undefined) && lead.status === "open" && !lead.proposal) {
      clientId = data.client ? (await actionClient(user, data.client))._id : null;
    }
    let companyName = lead.companyName;
    if (clientId) {
      const [client] = await db().select({ name: Client.name }).from(Client).where(eq(Client._id, clientId)).limit(1);
      if (client) companyName = client.name;
    } else {
      if (!data.companyName) throw new ActionError("Choose a client or enter a company name.", { companyName: "Company name is required" });
      companyName = data.companyName;
    }

    const fields = {
      client: clientId,
      companyName,
      title: data.title,
      contactName: data.contactName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      requirement: data.requirement ?? null,
      budget: data.budget ?? null,
      expectedValue: data.expectedValue ?? null,
      source: data.source ?? null,
      expectedCloseDate: data.expectedCloseDate ?? null,
      nextFollowUp: lead.status === "open" ? parseLocalDateTime(data.nextFollowUp) ?? null : null,
    };
    const set: SQLiteUpdateSetSource<typeof Lead> = { ...fields };

    const reassigned = assignedTo !== (lead.assignedTo ?? undefined);
    if (reassigned) {
      const names = await namesFor([lead.assignedTo, assignedTo]);
      set.history = jsonPush(
        Lead.history,
        historyEntry(user, "assigned", { from: names.get(lead.assignedTo ?? "") ?? "Unassigned", to: names.get(assignedTo ?? "") ?? "Unassigned" }),
      );
      set.assignedTo = assignedTo ?? null;
    }
    await db().update(Lead).set(set).where(eq(Lead._id, id));
    const after = snapshot({ ...lead, ...fields, assignedTo: reassigned ? assignedTo ?? null : lead.assignedTo });
    await audit(user, {
      action: "update",
      entity: "lead",
      entityId: lead._id,
      ref: lead.leadNo,
      summary: `Updated lead ${lead.leadNo}`,
      changes: diff(before, after, ["title", "client", "companyName", "contactName", "email", "phone", "requirement", "budget", "expectedValue", "source", "assignedTo", "nextFollowUp", "expectedCloseDate"], ["budget", "expectedValue"]),
    });
    if (reassigned) {
      await notify([assignedTo], { type: "crm", title: `Lead assigned to you: ${data.title}`, body: companyName, link: `/crm/leads/${lead._id}`, actionable: true }, [user._id]);
    }
    return { id: lead._id };
  }, "Lead updated");
}

export async function moveLeadStage(id: string, stageKey: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    const lead = await actionLead(user, id);
    const settings = await getSettings();
    const target = stageByKey(settings.pipelineStages, stageKey);
    if (!target) throw new ActionError("That pipeline stage no longer exists.");
    if (target.category !== "open") throw new ActionError(`Use "Mark ${target.category}" to close a lead.`);
    if (lead.status !== "open") throw new ActionError("This lead is closed. Reopen it to change its stage.");
    if (lead.stage === target.key) throw new ActionError("The lead is already in this stage.");
    await setOpenStage(user, id, target.key);
    return null;
  }, "Stage updated");
}

const lostSchema = z.object({ reason: zs.text("Reason", 200), note: zs.optText(2000) });

export async function markLeadLost(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    await actionLead(user, id);
    const data = parse(lostSchema, input);
    const settings = await getSettings();
    const lost = firstStageOf(settings.pipelineStages, "lost");
    if (!lost) throw new ActionError("No \"lost\" pipeline stage is configured. Ask an administrator to add one in Configuration.");
    const [lead] = await db().select().from(Lead).where(eq(Lead._id, id)).limit(1);
    if (!lead) throw new ActionError("This lead no longer exists.");
    if (lead.status !== "open") throw new ActionError("Only open leads can be marked lost.");

    const from = lead.stage;
    await db()
      .update(Lead)
      .set({
        stage: lost.key,
        status: "lost",
        lostReason: data.reason,
        closedAt: new Date(),
        nextFollowUp: null,
        history: jsonPush(Lead.history, historyEntry(user, "lost", { from, to: lost.key, note: [data.reason, data.note].filter(Boolean).join(" — ") })),
      })
      .where(eq(Lead._id, lead._id));
    await closePendingFollowUps(lead._id, "Lead lost");
    await audit(user, {
      action: "status",
      entity: "lead",
      entityId: lead._id,
      ref: lead.leadNo,
      summary: `Marked ${lead.leadNo} lost: ${data.reason}`,
      changes: [{ field: "status", from: "open", to: "lost" }],
    });
    await notify([lead.assignedTo, lead.createdBy], { type: "crm", title: `Lead lost: ${lead.title}`, body: data.reason, link: `/crm/leads/${lead._id}` }, [user._id]);
    return null;
  }, "Lead marked lost");
}

export async function markLeadWon(id: string): Promise<ActionResult<{ leadId: string; clientId: string; clientNo: string; createdClient: boolean }>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    const lead = await actionLead(user, id);
    if (lead.status !== "open") throw new ActionError(lead.status === "won" ? "This lead is already won." : "This lead was marked lost. Reopen it first.");
    const res = await closeLeadWon(user, id);
    await notify([lead.assignedTo, lead.createdBy], { type: "crm", title: `Lead won: ${lead.title}`, body: lead.companyName, link: `/crm/leads/${id}` }, [user._id]);
    return { leadId: id, ...res };
  }, "Lead marked won");
}

export async function reopenLead(id: string, stageKey: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    await actionLead(user, id);
    const settings = await getSettings();
    const target = stageByKey(settings.pipelineStages, stageKey);
    if (!target || target.category !== "open") throw new ActionError("Choose an open pipeline stage.", { stage: "Choose an open stage" });
    const [lead] = await db().select().from(Lead).where(eq(Lead._id, id)).limit(1);
    if (!lead) throw new ActionError("This lead no longer exists.");
    if (lead.status !== "lost") throw new ActionError("Only lost leads can be reopened.");
    const from = lead.stage;
    await db()
      .update(Lead)
      .set({
        status: "open",
        stage: target.key,
        lostReason: null,
        closedAt: null,
        history: jsonPush(Lead.history, historyEntry(user, "reopened", { from, to: target.key })),
      })
      .where(eq(Lead._id, lead._id));
    await audit(user, { action: "status", entity: "lead", entityId: lead._id, ref: lead.leadNo, summary: `Reopened ${lead.leadNo}`, changes: [{ field: "status", from: "lost", to: "open" }] });
    return null;
  }, "Lead reopened");
}

export async function deleteLead(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.delete");
    const lead = await actionLead(user, id);
    const linkedProposals = await db().$count(Proposal, eq(Proposal.lead, lead._id));
    if (linkedProposals > 0 || lead.proposal || lead.project) {
      throw new ActionError("This lead has a proposal or project linked to it and can't be deleted.");
    }
    await db().delete(Activity).where(eq(Activity.lead, lead._id));
    await db().delete(Lead).where(eq(Lead._id, lead._id));
    await audit(user, { action: "delete", entity: "lead", entityId: lead._id, ref: lead.leadNo, summary: `Deleted lead ${lead.leadNo}: ${lead.title}` });
    return null;
  }, "Lead deleted");
}

/* -------------------------------------------------------------- activities */

const activitySchema = z.object({
  lead: zs.optId(),
  client: zs.optId(),
  type: z.enum(["call", "meeting", "email", "whatsapp", "note", "follow_up"], { error: "Choose an activity type" }),
  subject: zs.text("Subject", 300),
  notes: zs.optText(10000),
  at: zs.optDateTime(),
  dueAt: zs.optDateTime(),
  assignedTo: zs.optId(),
  nextFollowUpAt: zs.optDateTime(),
  nextFollowUpAssignee: zs.optId(),
});

export async function saveActivity(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    const data = parse(activitySchema, input);
    if (!data.lead && !data.client) throw new ActionError("Choose a lead or a client for this activity.");

    const lead = data.lead ? await actionLead(user, data.lead) : null;
    let clientId = lead?.client;
    if (data.client) {
      const client = await actionClient(user, data.client);
      if (lead?.client && lead.client !== client._id) throw new ActionError("This lead belongs to a different client.");
      clientId = client._id;
    }
    const link = lead ? `/crm/leads/${lead._id}` : `/crm/clients/${clientId}`;

    const scheduleFollowUp = async (dueText: string, assigneeId: string | undefined, subject: string, field: "dueAt" | "nextFollowUpAt", notes?: string) => {
      const dueAt = parseLocalDateTime(dueText);
      if (!dueAt) throw new ActionError("Enter a valid follow-up date and time.", { [field]: "Enter a valid date and time" });
      const assignee = (await assertPerson(assigneeId)) ?? user._id;
      const [doc] = await db()
        .insert(Activity)
        .values({
          client: clientId,
          lead: lead?._id,
          type: "follow_up",
          subject,
          notes,
          at: new Date(),
          dueAt,
          done: false,
          by: user._id,
          byName: user.name,
          assignedTo: assignee,
        })
        .returning({ _id: Activity._id });
      await notify([assignee], { type: "crm", title: `Follow-up assigned: ${subject}`, body: `Due ${fmtDateTime(dueAt)}`, link, actionable: true }, [user._id]);
      return doc;
    };

    let activityId: string;
    if (data.type === "follow_up") {
      if (!data.dueAt) throw new ActionError("Set when the follow-up is due.", { dueAt: "Due date and time is required" });
      const doc = await scheduleFollowUp(data.dueAt, data.assignedTo, data.subject, "dueAt", data.notes);
      activityId = doc._id;
    } else {
      const [doc] = await db()
        .insert(Activity)
        .values({
          client: clientId,
          lead: lead?._id,
          type: data.type,
          subject: data.subject,
          notes: data.notes,
          at: parseLocalDateTime(data.at) ?? new Date(),
          done: true,
          by: user._id,
          byName: user.name,
        })
        .returning({ _id: Activity._id });
      activityId = doc._id;
      if (data.nextFollowUpAt) await scheduleFollowUp(data.nextFollowUpAt, data.nextFollowUpAssignee, `Follow up: ${data.subject}`, "nextFollowUpAt");
    }
    if (lead) await refreshNextFollowUp(lead._id);
    await audit(user, {
      action: "create",
      entity: "activity",
      entityId: activityId,
      ref: lead?.leadNo,
      summary: `${data.type === "follow_up" ? "Scheduled follow-up" : "Logged " + data.type}: ${data.subject}`,
    });
    return { id: activityId };
  }, "Activity saved");
}

export async function completeFollowUp(id: string, outcome?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!can(user, "crm.view")) throw new ActionError("You don't have permission to do this.");
    if (!isObjectId(id)) throw new ActionError("This follow-up no longer exists.");
    const [activity] = await db().select().from(Activity).where(eq(Activity._id, id)).limit(1);
    if (!activity || activity.type !== "follow_up") throw new ActionError("This follow-up no longer exists.");
    const mine = [activity.assignedTo, activity.by].some((p) => p === user.id);
    if (!can(user, "crm.manage") && !mine) throw new ActionError("You don't have permission to do this.");
    if (activity.lead) await actionLead(user, activity.lead);
    if (activity.client) await actionClient(user, activity.client);
    if (activity.done) throw new ActionError("This follow-up is already done.");

    const dueAt = activity.dueAt;
    await db()
      .update(Activity)
      .set({ done: true, doneAt: new Date(), outcome: outcome?.trim().slice(0, 2000) || null })
      .where(eq(Activity._id, id));
    if (activity.lead) await refreshNextFollowUp(activity.lead, dueAt);
    await audit(user, { action: "update", entity: "activity", entityId: activity._id, summary: `Completed follow-up: ${activity.subject}` });
    return null;
  }, "Follow-up marked done");
}

/* ------------------------------------------------------------- attachments */

const attachSchema = z.object({ attachments: zs.ids() });

async function resolveTarget(entity: string, id: string) {
  const user = await actionPermission("crm.manage");
  if (entity === "lead") {
    const lead = await actionLead(user, id);
    const [client] = lead.client ? await db().select({ confidential: Client.confidential }).from(Client).where(eq(Client._id, lead.client)).limit(1) : [];
    return { user, confidential: Boolean(client?.confidential), label: lead.leadNo };
  }
  if (entity === "client") {
    const client = await actionClient(user, id);
    return { user, confidential: client.confidential, label: client.clientNo };
  }
  throw new ActionError("Unknown record type.");
}

export async function addAttachments(entity: "lead" | "client", id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, label } = await resolveTarget(entity, id);
    const data = parse(attachSchema, input);
    if (data.attachments.length === 0) throw new ActionError("Choose at least one file to attach.");
    const refs: FileRef[] = await resolveFileRefs(user, data.attachments);
    if (refs.length === 0) throw new ActionError("The uploaded files could not be attached.");
    const entries = refs.map((r) => ({ ...r, _id: newId() }));
    if (entity === "lead") await db().update(Lead).set({ attachments: jsonPush(Lead.attachments, ...entries) }).where(eq(Lead._id, id));
    else await db().update(Client).set({ attachments: jsonPush(Client.attachments, ...entries) }).where(eq(Client._id, id));
    await audit(user, { action: "update", entity, entityId: id, ref: label, summary: `Attached ${refs.length} file(s) to ${label}` });
    return null;
  }, "Files attached");
}

export async function removeAttachment(entity: "lead" | "client", id: string, fileRefId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, label } = await resolveTarget(entity, id);
    const [row] =
      entity === "lead"
        ? await db().select({ attachments: Lead.attachments }).from(Lead).where(eq(Lead._id, id)).limit(1)
        : await db().select({ attachments: Client.attachments }).from(Client).where(eq(Client._id, id)).limit(1);
    const attachments = row?.attachments;
    const ref = attachments?.find((a) => a._id === fileRefId);
    if (!ref || !attachments) throw new ActionError("This attachment no longer exists.");
    const remaining = attachments.filter((a) => a._id !== ref._id);
    if (entity === "lead") await db().update(Lead).set({ attachments: remaining }).where(eq(Lead._id, id));
    else await db().update(Client).set({ attachments: remaining }).where(eq(Client._id, id));
    await db().update(StoredFile).set({ deletedAt: new Date(), deletedBy: user._id }).where(eq(StoredFile._id, ref.file));
    await audit(user, { action: "delete", entity, entityId: id, ref: label, summary: `Removed attachment ${ref.name} from ${label}` });
    return null;
  }, "Attachment removed");
}
