"use server";

import { z } from "zod";
import { Types } from "mongoose";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { Activity, Client, Lead, Proposal, StoredFile, User, type FileRef } from "@/lib/models";
import { resolveFileRefs } from "@/lib/files";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES, namesFor } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { fmtDateTime, parseLocalDateTime } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { actionClient, actionLead } from "./_lib/access";
import { findDuplicates, type DuplicateReport } from "./_lib/duplicates";
import { closeLeadWon, closePendingFollowUps, historyEntry, refreshNextFollowUp, setOpenStage } from "./_lib/leads";
import { firstStageOf, stageByKey } from "./_lib/pipeline";

export type LeadSaveResult = { id: string } | { duplicates: DuplicateReport };

/* ------------------------------------------------------------------ helpers */

/** Lead assignees must be active employees: interns and trainees never see client data (FRS §3.2). */
async function assertPerson(id: string | undefined): Promise<Types.ObjectId | undefined> {
  if (!id) return undefined;
  const user = await User.findById(id, { personType: 1, status: 1 }).lean();
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
    const lead = await Lead.create({
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
    });
    await audit(user, { action: "create", entity: "lead", entityId: lead._id, ref: leadNo, summary: `Created lead ${leadNo}: ${lead.title} (${companyName})` });
    await notify([assignedTo], { type: "crm", title: `New lead assigned: ${lead.title}`, body: companyName, link: `/crm/leads/${lead._id}`, actionable: true }, [user._id]);
    return { id: lead._id.toString() };
  });
}

export async function updateLead(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    await actionLead(user, id);
    const data = parse(updateLeadSchema, input);
    const lead = await Lead.findById(id);
    if (!lead) throw new ActionError("This lead no longer exists.");
    assertPhone(data.phone);
    const assignedTo = await assertPerson(data.assignedTo);

    const snapshot = () => ({
      title: lead.title,
      client: lead.client,
      companyName: lead.companyName,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      requirement: lead.requirement,
      budget: lead.budget,
      expectedValue: lead.expectedValue,
      source: lead.source,
      assignedTo: lead.assignedTo,
      nextFollowUp: lead.nextFollowUp,
      expectedCloseDate: lead.expectedCloseDate,
    });
    const before = snapshot();

    // The client can only change while the lead is open and has no proposal attached.
    if (data.client !== lead.client?.toString() && lead.status === "open" && !lead.proposal) {
      lead.client = data.client ? (await actionClient(user, data.client))._id : undefined;
    }
    if (lead.client) {
      const client = await Client.findById(lead.client, { name: 1 }).lean();
      if (client) lead.companyName = client.name;
    } else {
      if (!data.companyName) throw new ActionError("Choose a client or enter a company name.", { companyName: "Company name is required" });
      lead.companyName = data.companyName;
    }

    lead.title = data.title;
    lead.contactName = data.contactName;
    lead.email = data.email;
    lead.phone = data.phone;
    lead.requirement = data.requirement;
    lead.budget = data.budget;
    lead.expectedValue = data.expectedValue;
    lead.source = data.source;
    lead.expectedCloseDate = data.expectedCloseDate;
    lead.nextFollowUp = lead.status === "open" ? parseLocalDateTime(data.nextFollowUp) ?? undefined : undefined;

    const reassigned = assignedTo?.toString() !== lead.assignedTo?.toString();
    if (reassigned) {
      const names = await namesFor([lead.assignedTo, assignedTo]);
      lead.history.push(
        historyEntry(user, "assigned", { from: names.get(lead.assignedTo?.toString() ?? "") ?? "Unassigned", to: names.get(assignedTo?.toString() ?? "") ?? "Unassigned" }),
      );
      lead.assignedTo = assignedTo;
    }
    await lead.save();
    const after = snapshot();
    await audit(user, {
      action: "update",
      entity: "lead",
      entityId: lead._id,
      ref: lead.leadNo,
      summary: `Updated lead ${lead.leadNo}`,
      changes: diff(before, after, ["title", "client", "companyName", "contactName", "email", "phone", "requirement", "budget", "expectedValue", "source", "assignedTo", "nextFollowUp", "expectedCloseDate"], ["budget", "expectedValue"]),
    });
    if (reassigned) {
      await notify([assignedTo], { type: "crm", title: `Lead assigned to you: ${lead.title}`, body: lead.companyName, link: `/crm/leads/${lead._id}`, actionable: true }, [user._id]);
    }
    return { id: lead._id.toString() };
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
    const lead = await Lead.findById(id);
    if (!lead) throw new ActionError("This lead no longer exists.");
    if (lead.status !== "open") throw new ActionError("Only open leads can be marked lost.");

    const from = lead.stage;
    lead.stage = lost.key;
    lead.status = "lost";
    lead.lostReason = data.reason;
    lead.closedAt = new Date();
    lead.nextFollowUp = undefined;
    lead.history.push(historyEntry(user, "lost", { from, to: lost.key, note: [data.reason, data.note].filter(Boolean).join(" — ") }));
    await lead.save();
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
    const lead = await Lead.findById(id);
    if (!lead) throw new ActionError("This lead no longer exists.");
    if (lead.status !== "lost") throw new ActionError("Only lost leads can be reopened.");
    const from = lead.stage;
    lead.status = "open";
    lead.stage = target.key;
    lead.lostReason = undefined;
    lead.closedAt = undefined;
    lead.history.push(historyEntry(user, "reopened", { from, to: target.key }));
    await lead.save();
    await audit(user, { action: "status", entity: "lead", entityId: lead._id, ref: lead.leadNo, summary: `Reopened ${lead.leadNo}`, changes: [{ field: "status", from: "lost", to: "open" }] });
    return null;
  }, "Lead reopened");
}

export async function deleteLead(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.delete");
    const lead = await actionLead(user, id);
    const linkedProposals = await Proposal.countDocuments({ lead: lead._id });
    if (linkedProposals > 0 || lead.proposal || lead.project) {
      throw new ActionError("This lead has a proposal or project linked to it and can't be deleted.");
    }
    await Activity.deleteMany({ lead: lead._id });
    await Lead.deleteOne({ _id: lead._id });
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
      if (lead?.client && lead.client.toString() !== client._id.toString()) throw new ActionError("This lead belongs to a different client.");
      clientId = client._id;
    }
    const link = lead ? `/crm/leads/${lead._id}` : `/crm/clients/${clientId}`;

    const scheduleFollowUp = async (dueText: string, assigneeId: string | undefined, subject: string, field: "dueAt" | "nextFollowUpAt", notes?: string) => {
      const dueAt = parseLocalDateTime(dueText);
      if (!dueAt) throw new ActionError("Enter a valid follow-up date and time.", { [field]: "Enter a valid date and time" });
      const assignee = (await assertPerson(assigneeId)) ?? user._id;
      const doc = await Activity.create({
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
      });
      await notify([assignee], { type: "crm", title: `Follow-up assigned: ${subject}`, body: `Due ${fmtDateTime(dueAt)}`, link, actionable: true }, [user._id]);
      return doc;
    };

    let activityId: string;
    if (data.type === "follow_up") {
      if (!data.dueAt) throw new ActionError("Set when the follow-up is due.", { dueAt: "Due date and time is required" });
      const doc = await scheduleFollowUp(data.dueAt, data.assignedTo, data.subject, "dueAt", data.notes);
      activityId = doc._id.toString();
    } else {
      const doc = await Activity.create({
        client: clientId,
        lead: lead?._id,
        type: data.type,
        subject: data.subject,
        notes: data.notes,
        at: parseLocalDateTime(data.at) ?? new Date(),
        done: true,
        by: user._id,
        byName: user.name,
      });
      activityId = doc._id.toString();
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
    const activity = await Activity.findById(id);
    if (!activity || activity.type !== "follow_up") throw new ActionError("This follow-up no longer exists.");
    const mine = [activity.assignedTo, activity.by].some((p) => p?.toString() === user.id);
    if (!can(user, "crm.manage") && !mine) throw new ActionError("You don't have permission to do this.");
    if (activity.lead) await actionLead(user, activity.lead.toString());
    if (activity.client) await actionClient(user, activity.client.toString());
    if (activity.done) throw new ActionError("This follow-up is already done.");

    const dueAt = activity.dueAt;
    activity.done = true;
    activity.doneAt = new Date();
    activity.outcome = outcome?.trim().slice(0, 2000) || undefined;
    await activity.save();
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
    const client = lead.client ? await Client.findById(lead.client, { confidential: 1 }).lean() : null;
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
    if (entity === "lead") await Lead.updateOne({ _id: id }, { $push: { attachments: { $each: refs } } });
    else await Client.updateOne({ _id: id }, { $push: { attachments: { $each: refs } } });
    await audit(user, { action: "update", entity, entityId: id, ref: label, summary: `Attached ${refs.length} file(s) to ${label}` });
    return null;
  }, "Files attached");
}

export async function removeAttachment(entity: "lead" | "client", id: string, fileRefId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, label } = await resolveTarget(entity, id);
    const attachments = entity === "lead" ? (await Lead.findById(id, { attachments: 1 }).lean())?.attachments : (await Client.findById(id, { attachments: 1 }).lean())?.attachments;
    const ref = attachments?.find((a) => a._id?.toString() === fileRefId);
    if (!ref) throw new ActionError("This attachment no longer exists.");
    if (entity === "lead") await Lead.updateOne({ _id: id }, { $pull: { attachments: { _id: ref._id } } });
    else await Client.updateOne({ _id: id }, { $pull: { attachments: { _id: ref._id } } });
    await StoredFile.updateOne({ _id: ref.file }, { $set: { deletedAt: new Date(), deletedBy: user._id } });
    await audit(user, { action: "delete", entity, entityId: id, ref: label, summary: `Removed attachment ${ref.name} from ${label}` });
    return null;
  }, "Attachment removed");
}
