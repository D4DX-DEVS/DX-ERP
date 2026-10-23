import "server-only";
import { Types } from "mongoose";
import { ActionError } from "@/lib/action-result";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { connectDB } from "@/lib/db";
import { Activity, Client, Lead, type ClientStatus, type HistoryEntry, type IClient } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { firstStageOf, stageByKey } from "./pipeline";

type Actor = Pick<CurrentUser, "_id" | "name" | "role">;

export function historyEntry(user: Pick<CurrentUser, "_id" | "name">, action: string, extra: Partial<Pick<HistoryEntry, "note" | "from" | "to">> = {}): HistoryEntry {
  return { action, by: user._id, byName: user.name, at: new Date(), ...extra };
}

/** Creates a client record from a lead's contact data. */
export async function createClientFromLead(
  user: Actor,
  lead: { companyName: string; contactName?: string; email?: string; phone?: string; source?: string; assignedTo?: Types.ObjectId },
  status: ClientStatus,
): Promise<IClient> {
  const clientNo = await nextNumber("client", ID_PREFIX.client, 4);
  const doc = await Client.create({
    clientNo,
    name: lead.companyName,
    type: "company",
    contactPerson: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    leadSource: lead.source,
    owner: lead.assignedTo ?? user._id,
    status,
    confidential: false,
    createdBy: user._id,
  });
  await audit(user, { action: "create", entity: "client", entityId: doc._id, ref: clientNo, summary: `Created client ${doc.name} (${clientNo}) from a lead` });
  return doc.toObject();
}

/**
 * Makes sure the lead is linked to a client, creating one from the lead's data when needed.
 * Back-fills the client on the lead's activities so they show up in the client's communication history.
 */
export async function ensureLeadClient(user: Actor, leadId: Types.ObjectId | string, status: ClientStatus): Promise<{ client: IClient; created: boolean }> {
  await connectDB();
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ActionError("This lead no longer exists.");
  if (lead.client) {
    const existing = await Client.findById(lead.client).lean();
    if (existing) return { client: existing, created: false };
  }
  const client = await createClientFromLead(user, lead, status);
  lead.client = client._id;
  await lead.save();
  await Activity.updateMany({ lead: lead._id, client: null }, { $set: { client: client._id } });
  return { client, created: true };
}

/** Moves an open lead to another open stage, recording history and an audit entry. Returns whether it moved. */
export async function setOpenStage(user: Actor, leadId: Types.ObjectId | string, stageKey: string, opts: { onlyForward?: boolean } = {}): Promise<boolean> {
  await connectDB();
  const settings = await getSettings();
  const stages = settings.pipelineStages;
  const target = stageByKey(stages, stageKey);
  if (!target || target.category !== "open") throw new ActionError("Choose an open pipeline stage.");
  const lead = await Lead.findById(leadId);
  if (!lead || lead.status !== "open" || lead.stage === target.key) return false;
  if (opts.onlyForward) {
    const from = stages.findIndex((s) => s.key === lead.stage);
    const to = stages.findIndex((s) => s.key === target.key);
    if (from >= to) return false;
  }
  const from = lead.stage;
  lead.stage = target.key;
  lead.history.push(historyEntry(user, "stage", { from, to: target.key }));
  await lead.save();
  await audit(user, {
    action: "status",
    entity: "lead",
    entityId: lead._id,
    ref: lead.leadNo,
    summary: `Moved ${lead.leadNo} from ${stageByKey(stages, from)?.label ?? from} to ${target.label}`,
    changes: [{ field: "stage", from, to: target.key }],
  });
  return true;
}

/** Closes pending follow-ups of a lead that has just been won or lost. */
export async function closePendingFollowUps(leadId: Types.ObjectId | string, outcome: string): Promise<void> {
  await Activity.updateMany({ lead: leadId, type: "follow_up", done: false }, { $set: { done: true, doneAt: new Date(), outcome } });
}

/**
 * Marks a lead won: ensures it has a client (created from the lead when missing, status active),
 * moves it to the "won" stage and links the proposal when given. Idempotent for already-won leads.
 */
export async function closeLeadWon(
  user: Actor,
  leadId: Types.ObjectId | string,
  opts: { proposalId?: Types.ObjectId | string; summary?: string } = {},
): Promise<{ clientId: string; clientNo: string; createdClient: boolean }> {
  await connectDB();
  const settings = await getSettings();
  const won = firstStageOf(settings.pipelineStages, "won");
  if (!won) throw new ActionError("No \"won\" pipeline stage is configured. Ask an administrator to add one in Configuration.");

  const lead = await Lead.findById(leadId);
  if (!lead) throw new ActionError("This lead no longer exists.");
  if (lead.status === "lost") throw new ActionError("This lead was marked lost. Reopen it before marking it won.");

  let client = lead.client ? await Client.findById(lead.client) : null;
  let createdClient = false;
  if (!client) {
    const created = await createClientFromLead(user, lead, "active");
    client = await Client.findById(created._id);
    createdClient = true;
    if (!client) throw new ActionError("Could not create the client for this lead.");
    lead.client = client._id;
  } else if (client.status !== "active") {
    client.status = "active";
    await client.save();
  }

  if (opts.proposalId) lead.proposal = new Types.ObjectId(opts.proposalId.toString());
  if (lead.status === "open") {
    const from = lead.stage;
    const now = new Date();
    lead.stage = won.key;
    lead.status = "won";
    lead.closedAt = now;
    lead.convertedAt = now;
    lead.nextFollowUp = undefined;
    lead.lostReason = undefined;
    lead.history.push(historyEntry(user, "won", { from, to: won.key, note: opts.summary }));
  }
  await lead.save();

  await Activity.updateMany({ lead: lead._id, client: null }, { $set: { client: client._id } });
  await closePendingFollowUps(lead._id, "Lead won");
  await audit(user, {
    action: "status",
    entity: "lead",
    entityId: lead._id,
    ref: lead.leadNo,
    summary: `Marked ${lead.leadNo} won${createdClient ? ` and created client ${client.clientNo}` : ""}`,
  });
  return { clientId: client._id.toString(), clientNo: client.clientNo, createdClient };
}

/**
 * Keeps `lead.nextFollowUp` in step with the lead's pending follow-up activities: it becomes the
 * earliest pending due date (a still-future date set on the lead itself is kept as a candidate).
 * Pass `completed` when a follow-up has just been finished so that date is dropped.
 */
export async function refreshNextFollowUp(leadId: Types.ObjectId | string, completed?: Date): Promise<void> {
  await connectDB();
  const lead = await Lead.findById(leadId, { nextFollowUp: 1, status: 1 });
  if (!lead || lead.status !== "open") return;
  const pending = await Activity.find({ lead: leadId, type: "follow_up", done: false }, { dueAt: 1 }).lean();
  const dates = pending.map((p) => p.dueAt).filter((d): d is Date => Boolean(d));
  const current = lead.nextFollowUp;
  const keepCurrent = current && !(completed && current.getTime() === completed.getTime());
  if (keepCurrent && current.getTime() > Date.now()) dates.push(current);
  const next = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : keepCurrent ? current : undefined;
  if (next?.getTime() === current?.getTime()) return;
  lead.nextFollowUp = next;
  await lead.save();
}
