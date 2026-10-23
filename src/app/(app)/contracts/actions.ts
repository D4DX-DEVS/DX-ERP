"use server";

import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { db } from "@/lib/db";
import { Contract, newId, Project, Proposal, StoredFile, type FileRef, type IContract } from "@/lib/models";
import { resolveFileRefs } from "@/lib/files";
import { inList, jsonPush } from "@/lib/sql";
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
    const [project] = await db().select({ client: Project.client }).from(Project).where(eq(Project._id, projectId)).limit(1);
    if (!project) throw new ActionError("The selected project no longer exists.", { project: "Choose a valid project" });
    if (project.client && project.client !== clientId) throw new ActionError("That project belongs to a different client.", { project: "Belongs to a different client" });
  }
  if (proposalId) {
    const [proposal] = await db().select({ client: Proposal.client }).from(Proposal).where(eq(Proposal._id, proposalId)).limit(1);
    if (!proposal) throw new ActionError("The selected proposal no longer exists.", { proposal: "Choose a valid proposal" });
    if (proposal.client !== clientId) throw new ActionError("That proposal belongs to a different client.", { proposal: "Belongs to a different client" });
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
    const [contract] = await db()
      .insert(Contract)
      .values({
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
        attachments: files.map((f) => ({ ...f, _id: newId() })),
        history: [historyEntry(user, "created", { to: data.status })],
        createdBy: user._id,
      })
      .returning();
    if (files.length > 0) {
      // Files were uploaded before the contract existed: bind them to it and mirror its confidentiality.
      await db()
        .update(StoredFile)
        .set({ entityId: contract._id, confidential: data.confidential })
        .where(and(inList(StoredFile._id, files.map((f) => f.file)), eq(StoredFile.entityType, "contract"), isNull(StoredFile.entityId)));
    }
    await audit(user, { action: "create", entity: "contract", entityId: contract._id, ref: contractNo, summary: `Created contract ${contractNo}: ${data.title} for ${client.name}` });
    return { id: contract._id };
  }, "Contract saved");
}

export async function updateContract(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    await actionContract(user, id);
    const data = parse(updateSchema, input);
    checkDates(data.startDate, data.endDate);
    const [contract] = await db().select().from(Contract).where(eq(Contract._id, id)).limit(1);
    if (!contract) throw new ActionError("This contract no longer exists.");
    const client = await actionClient(user, data.client);
    await checkLinks(data.client, data.project, data.proposal);

    const snapshot = (c: IContract) => ({
      title: c.title,
      client: c.client,
      project: c.project,
      proposal: c.proposal,
      type: c.type,
      startDate: c.startDate,
      endDate: c.endDate,
      value: c.value,
      signedOn: c.signedOn,
      status: c.status,
      renewalReminderDays: c.renewalReminderDays,
      autoRenew: c.autoRenew,
      confidential: c.confidential,
    });
    const before = snapshot(contract);

    const fields = {
      title: data.title,
      client: client._id,
      project: data.project ?? null,
      proposal: data.proposal ?? null,
      type: data.type ?? null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      value: data.value ?? 0,
      signedOn: data.signedOn ?? null,
      // draft ⇄ active only; expired / terminated / renewed contracts keep their lifecycle status.
      status: contract.status === "draft" || contract.status === "active" ? data.status : contract.status,
      renewalReminderDays: data.renewalReminderDays,
      autoRenew: data.autoRenew,
      confidential: data.confidential,
      notes: data.notes ?? null,
    };
    await db()
      .update(Contract)
      .set({
        ...fields,
        ...((contract.endDate ?? undefined) !== data.endDate ? { reminderSentAt: null } : {}),
        history: jsonPush(Contract.history, historyEntry(user, "updated")),
      })
      .where(eq(Contract._id, id));
    const updated: IContract = { ...contract, ...fields };

    if (before.confidential !== updated.confidential && contract.attachments.length > 0) {
      await db()
        .update(StoredFile)
        .set({ confidential: updated.confidential })
        .where(inList(StoredFile._id, contract.attachments.map((a) => a.file)));
    }
    await audit(user, {
      action: "update",
      entity: "contract",
      entityId: contract._id,
      ref: contract.contractNo,
      summary: `Updated contract ${contract.contractNo}`,
      changes: diff(before, snapshot(updated), ["title", "client", "project", "proposal", "type", "startDate", "endDate", "value", "signedOn", "status", "renewalReminderDays", "autoRenew", "confidential"], ["value"]),
    });
    return { id: contract._id };
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
    const [claimed] = await db()
      .update(Contract)
      .set({ status: "renewed" })
      .where(and(eq(Contract._id, id), inList(Contract.status, ["active", "expired"])))
      .returning({ id: Contract._id });
    if (!claimed) throw new ActionError("This contract was already renewed or closed.");

    try {
      const contractNo = await nextNumber("contract", ID_PREFIX.contract, 4);
      const [fresh] = await db()
        .insert(Contract)
        .values({
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
        })
        .returning();
      await db()
        .update(Contract)
        .set({ history: jsonPush(Contract.history, historyEntry(user, "renewed", { note: `Renewed as ${contractNo}`, from: old.status, to: "renewed" })) })
        .where(eq(Contract._id, id));
      await audit(user, { action: "create", entity: "contract", entityId: fresh._id, ref: contractNo, summary: `Renewed ${old.contractNo} as ${contractNo}` });
      await audit(user, { action: "status", entity: "contract", entityId: old._id, ref: old.contractNo, summary: `${old.contractNo} marked renewed`, changes: [{ field: "status", from: old.status, to: "renewed" }] });
      return { id: fresh._id };
    } catch (error) {
      await db().update(Contract).set({ status: old.status }).where(and(eq(Contract._id, id), eq(Contract.status, "renewed")));
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
    await db()
      .update(Contract)
      .set({ status: "terminated", history: jsonPush(Contract.history, historyEntry(user, "terminated", { note: data.reason, from: c.status, to: "terminated" })) })
      .where(eq(Contract._id, id));
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
    await db()
      .update(Contract)
      .set({ attachments: jsonPush(Contract.attachments, ...refs.map((r) => ({ ...r, _id: newId() }))) })
      .where(eq(Contract._id, id));
    await db()
      .update(StoredFile)
      .set({ entityId: id, confidential: c.confidential })
      .where(and(inList(StoredFile._id, refs.map((r) => r.file)), eq(StoredFile.entityType, "contract"), or(isNull(StoredFile.entityId), eq(StoredFile.entityId, id))));
    await audit(user, { action: "update", entity: "contract", entityId: c._id, ref: c.contractNo, summary: `Attached ${refs.length} file(s) to ${c.contractNo}` });
    return null;
  }, "Files attached");
}

export async function removeContractFile(id: string, fileRefId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("contracts.manage");
    const c = await actionContract(user, id);
    const ref = c.attachments.find((a) => a._id === fileRefId);
    if (!ref) throw new ActionError("This file no longer exists.");
    await db()
      .update(Contract)
      .set({ attachments: c.attachments.filter((a) => a._id !== ref._id) })
      .where(eq(Contract._id, id));
    await db().update(StoredFile).set({ deletedAt: new Date(), deletedBy: user._id }).where(eq(StoredFile._id, ref.file));
    await audit(user, { action: "delete", entity: "contract", entityId: c._id, ref: c.contractNo, summary: `Removed ${ref.name} from ${c.contractNo}` });
    return null;
  }, "File removed");
}
