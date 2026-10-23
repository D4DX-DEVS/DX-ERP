"use server";

import { z } from "zod";
import { Types } from "mongoose";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { Contract, Project, Proposal, StoredFile, type FileRef } from "@/lib/models";
import { resolveFileRefs } from "@/lib/files";
import { zs } from "@/lib/validation";
import { actionClient } from "@/app/(app)/crm/_lib/access";
import { historyEntry } from "@/app/(app)/crm/_lib/leads";
import { actionContract } from "./_access";

const fields = {
  title: zs.text("Title", 200),
  client: zs.id("Client"),
  project: zs.optId(),
  proposal: zs.optId(),
  type: zs.optText(60),
  startDate: zs.optDate(),
  endDate: zs.optDate(),
  value: zs.optNum({ min: 0 }),
  signedOn: zs.optDate(),
  status: z.enum(["draft", "active"], { error: "Choose a status" }),
  renewalReminderDays: zs.num("Reminder days", { min: 0, max: 365 }),
  autoRenew: zs.bool(),
  confidential: zs.bool(),
  notes: zs.optText(5000),
};

const createSchema = z.object({ ...fields, attachments: zs.ids() });
const updateSchema = z.object(fields);

function checkDates(startDate?: string, endDate?: string) {
  if (startDate && endDate && endDate < startDate) {
    throw new ActionError("The end date is before the start date.", { endDate: "End date must be on or after the start date" });
  }
}

/** Links must point at records of the same client. */
async function checkLinks(clientId: string, projectId?: string, proposalId?: string) {
  if (projectId) {
    const project = await Project.findById(projectId, { client: 1 }).lean();
    if (!project) throw new ActionError("The selected project no longer exists.", { project: "Choose a valid project" });
    if (project.client && project.client.toString() !== clientId) throw new ActionError("That project belongs to a different client.", { project: "Belongs to a different client" });
  }
  if (proposalId) {
    const proposal = await Proposal.findById(proposalId, { client: 1 }).lean();
    if (!proposal) throw new ActionError("The selected proposal no longer exists.", { proposal: "Choose a valid proposal" });
    if (proposal.client.toString() !== clientId) throw new ActionError("That proposal belongs to a different client.", { proposal: "Belongs to a different client" });
  }
}

export async function createContract(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    const data = parse(createSchema, input);
    checkDates(data.startDate, data.endDate);
    const client = await actionClient(user, data.client);
    await checkLinks(data.client, data.project, data.proposal);
    const files: FileRef[] = await resolveFileRefs(user, data.attachments);

    const contractNo = await nextNumber("contract", ID_PREFIX.contract, 4);
    const contract = await Contract.create({
      contractNo,
      title: data.title,
      client: client._id,
      project: data.project,
      proposal: data.proposal,
      type: data.type,
      startDate: data.startDate,
      endDate: data.endDate,
      value: data.value ?? 0,
      signedOn: data.signedOn,
      status: data.status,
      confidential: data.confidential,
      renewalReminderDays: data.renewalReminderDays,
      autoRenew: data.autoRenew,
      notes: data.notes,
      attachments: files,
      history: [historyEntry(user, "created", { to: data.status })],
      createdBy: user._id,
    });
    if (files.length > 0) {
      // Files were uploaded before the contract existed: bind them to it and mirror its confidentiality.
      await StoredFile.updateMany(
        { _id: { $in: files.map((f) => f.file) }, entityType: "contract", $or: [{ entityId: null }, { entityId: { $exists: false } }] },
        { $set: { entityId: contract._id.toString(), confidential: data.confidential } },
      );
    }
    await audit(user, { action: "create", entity: "contract", entityId: contract._id, ref: contractNo, summary: `Created contract ${contractNo}: ${data.title} for ${client.name}` });
    return { id: contract._id.toString() };
  }, "Contract saved");
}

export async function updateContract(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    await actionContract(user, id);
    const data = parse(updateSchema, input);
    checkDates(data.startDate, data.endDate);
    const contract = await Contract.findById(id);
    if (!contract) throw new ActionError("This contract no longer exists.");
    const client = await actionClient(user, data.client);
    await checkLinks(data.client, data.project, data.proposal);

    const snapshot = () => ({
      title: contract.title,
      client: contract.client,
      project: contract.project,
      proposal: contract.proposal,
      type: contract.type,
      startDate: contract.startDate,
      endDate: contract.endDate,
      value: contract.value,
      signedOn: contract.signedOn,
      status: contract.status,
      renewalReminderDays: contract.renewalReminderDays,
      autoRenew: contract.autoRenew,
      confidential: contract.confidential,
    });
    const before = snapshot();

    if (contract.endDate !== data.endDate) contract.reminderSentAt = undefined;
    contract.title = data.title;
    contract.client = client._id;
    contract.project = data.project ? new Types.ObjectId(data.project) : undefined;
    contract.proposal = data.proposal ? new Types.ObjectId(data.proposal) : undefined;
    contract.type = data.type;
    contract.startDate = data.startDate;
    contract.endDate = data.endDate;
    contract.value = data.value ?? 0;
    contract.signedOn = data.signedOn;
    // draft ⇄ active only; expired / terminated / renewed contracts keep their lifecycle status.
    if (contract.status === "draft" || contract.status === "active") contract.status = data.status;
    contract.renewalReminderDays = data.renewalReminderDays;
    contract.autoRenew = data.autoRenew;
    contract.confidential = data.confidential;
    contract.notes = data.notes;
    contract.history.push(historyEntry(user, "updated"));
    await contract.save();

    if (before.confidential !== contract.confidential && contract.attachments.length > 0) {
      await StoredFile.updateMany({ _id: { $in: contract.attachments.map((a) => a.file) } }, { $set: { confidential: contract.confidential } });
    }
    await audit(user, {
      action: "update",
      entity: "contract",
      entityId: contract._id,
      ref: contract.contractNo,
      summary: `Updated contract ${contract.contractNo}`,
      changes: diff(before, snapshot(), ["title", "client", "project", "proposal", "type", "startDate", "endDate", "value", "signedOn", "status", "renewalReminderDays", "autoRenew", "confidential"], ["value"]),
    });
    return { id: contract._id.toString() };
  }, "Contract saved");
}

const renewSchema = z.object({
  startDate: zs.date("New start date"),
  endDate: zs.date("New end date"),
  value: zs.optNum({ min: 0 }),
  notes: zs.optText(5000),
});

/** Creates the next term as a new contract (renewedFrom) and marks this one renewed. */
export async function renewContract(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    const old = await actionContract(user, id);
    const data = parse(renewSchema, input);
    checkDates(data.startDate, data.endDate);
    if (old.status !== "active" && old.status !== "expired") throw new ActionError("Only active or expired contracts can be renewed.");

    // Claim the old contract first so two people can't renew it twice.
    const claimed = await Contract.findOneAndUpdate({ _id: id, status: { $in: ["active", "expired"] } }, { $set: { status: "renewed" } }, { returnDocument: "after" });
    if (!claimed) throw new ActionError("This contract was already renewed or closed.");

    try {
      const contractNo = await nextNumber("contract", ID_PREFIX.contract, 4);
      const fresh = await Contract.create({
        contractNo,
        title: old.title,
        client: old.client,
        project: old.project,
        proposal: old.proposal,
        type: old.type,
        startDate: data.startDate,
        endDate: data.endDate,
        value: data.value ?? old.value,
        status: "active",
        confidential: old.confidential,
        renewalReminderDays: old.renewalReminderDays,
        autoRenew: old.autoRenew,
        notes: data.notes,
        renewedFrom: old._id,
        history: [historyEntry(user, "created", { note: `Renewal of ${old.contractNo}`, to: "active" })],
        createdBy: user._id,
      });
      await Contract.updateOne({ _id: id }, { $push: { history: historyEntry(user, "renewed", { note: `Renewed as ${contractNo}`, from: old.status, to: "renewed" }) } });
      await audit(user, { action: "create", entity: "contract", entityId: fresh._id, ref: contractNo, summary: `Renewed ${old.contractNo} as ${contractNo}` });
      await audit(user, { action: "status", entity: "contract", entityId: old._id, ref: old.contractNo, summary: `${old.contractNo} marked renewed`, changes: [{ field: "status", from: old.status, to: "renewed" }] });
      return { id: fresh._id.toString() };
    } catch (error) {
      await Contract.updateOne({ _id: id, status: "renewed" }, { $set: { status: old.status } });
      throw error;
    }
  }, "Contract renewed");
}

const terminateSchema = z.object({ reason: zs.text("Reason", 2000) });

export async function terminateContract(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    const c = await actionContract(user, id);
    const data = parse(terminateSchema, { reason });
    if (c.status !== "active" && c.status !== "draft") throw new ActionError("Only draft or active contracts can be terminated.");
    await Contract.updateOne({ _id: id }, { $set: { status: "terminated" }, $push: { history: historyEntry(user, "terminated", { note: data.reason, from: c.status, to: "terminated" }) } });
    await audit(user, { action: "status", entity: "contract", entityId: c._id, ref: c.contractNo, summary: `Terminated ${c.contractNo}: ${data.reason}`, changes: [{ field: "status", from: c.status, to: "terminated" }] });
    return null;
  }, "Contract terminated");
}

/* ------------------------------------------------------------------- files */

const attachSchema = z.object({ attachments: zs.ids() });

export async function addContractFiles(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    const c = await actionContract(user, id);
    const data = parse(attachSchema, input);
    if (data.attachments.length === 0) throw new ActionError("Choose at least one file to attach.");
    const refs: FileRef[] = await resolveFileRefs(user, data.attachments);
    if (refs.length === 0) throw new ActionError("The uploaded files could not be attached.");
    await Contract.updateOne({ _id: id }, { $push: { attachments: { $each: refs } } });
    await StoredFile.updateMany(
      { _id: { $in: refs.map((r) => r.file) }, entityType: "contract", $or: [{ entityId: null }, { entityId: { $exists: false } }, { entityId: id }] },
      { $set: { entityId: id, confidential: c.confidential } },
    );
    await audit(user, { action: "update", entity: "contract", entityId: c._id, ref: c.contractNo, summary: `Attached ${refs.length} file(s) to ${c.contractNo}` });
    return null;
  }, "Files attached");
}

export async function removeContractFile(id: string, fileRefId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    const c = await actionContract(user, id);
    const ref = c.attachments.find((a) => a._id?.toString() === fileRefId);
    if (!ref) throw new ActionError("This file no longer exists.");
    await Contract.updateOne({ _id: id }, { $pull: { attachments: { _id: ref._id } } });
    await StoredFile.updateOne({ _id: ref.file }, { $set: { deletedAt: new Date(), deletedBy: user._id } });
    await audit(user, { action: "delete", entity: "contract", entityId: c._id, ref: c.contractNo, summary: `Removed ${ref.name} from ${c.contractNo}` });
    return null;
  }, "File removed");
}
