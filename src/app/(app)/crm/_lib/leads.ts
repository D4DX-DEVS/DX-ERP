import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import { ActionError } from "@/lib/action-result";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { db } from "@/lib/db";
import { Activity, Client, Lead, newId, type ClientStatus, type HistoryEntry, type Id, type IClient } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { jsonPush } from "@/lib/sql";
import { firstStageOf, stageByKey } from "./pipeline";

type Actor = Pick<CurrentUser, "_id" | "name" | "role">;

export function historyEntry(user: Pick<CurrentUser, "_id" | "name">, action: string, extra: Partial<Pick<HistoryEntry, "note" | "from" | "to">> = {}): HistoryEntry {
  return { _id: newId(), action, by: user._id, byName: user.name, at: new Date(), ...extra };
}

/** Creates a client record from a lead's contact data. */
export async function createClientFromLead(
  user: Actor,
  lead: { companyName: string; contactName?: string | null; email?: string | null; phone?: string | null; source?: string | null; assignedTo?: Id | null },
  status: ClientStatus,
): Promise<IClient> {
  const clientNo = await nextNumber("client", ID_PREFIX.client, 4);
  const [doc] = await db()
    .insert(Client)
    .values({
      clientNo,
      name: lead.companyName.trim(),
      type: "company",
      contactPerson: lead.contactName,
      email: lead.email?.trim().toLowerCase(),
      phone: lead.phone?.trim(),
      leadSource: lead.source,
      owner: lead.assignedTo ?? user._id,
      status,
      confidential: false,
      createdBy: user._id,
    })
    .returning();
  await audit(user, { action: "create", entity: "client", entityId: doc._id, ref: clientNo, summary: `Created client ${doc.name} (${clientNo}) from a lead` });
  return doc;
}

/**
 * Makes sure the lead is linked to a client, creating one from the lead's data when needed.
 * Back-fills the client on the lead's activities so they show up in the client's communication history.
 */
export async function ensureLeadClient(user: Actor, leadId: Id, status: ClientStatus): Promise<{ client: IClient; created: boolean }> {
  const [lead] = await db().select().from(Lead).where(eq(Lead._id, leadId)).limit(1);
  if (!lead) throw new ActionError("This lead no longer exists.");
  if (lead.client) {
    const [existing] = await db().select().from(Client).where(eq(Client._id, lead.client)).limit(1);
    if (existing) return { client: existing, created: false };
  }
  const client = await createClientFromLead(user, lead, status);
  await db().update(Lead).set({ client: client._id }).where(eq(Lead._id, lead._id));
  await db().update(Activity).set({ client: client._id }).where(and(eq(Activity.lead, lead._id), isNull(Activity.client)));
  return { client, created: true };
}

/** Moves an open lead to another open stage, recording history and an audit entry. Returns whether it moved. */
export async function setOpenStage(user: Actor, leadId: Id, stageKey: string, opts: { onlyForward?: boolean } = {}): Promise<boolean> {
  const settings = await getSettings();
  const stages = settings.pipelineStages;
  const target = stageByKey(stages, stageKey);
  if (!target || target.category !== "open") throw new ActionError("Choose an open pipeline stage.");
  const [lead] = await db().select({ _id: Lead._id, leadNo: Lead.leadNo, stage: Lead.stage, status: Lead.status }).from(Lead).where(eq(Lead._id, leadId)).limit(1);
  if (!lead || lead.status !== "open" || lead.stage === target.key) return false;
  if (opts.onlyForward) {
    const from = stages.findIndex((s) => s.key === lead.stage);
    const to = stages.findIndex((s) => s.key === target.key);
    if (from >= to) return false;
  }
  const from = lead.stage;
  await db()
    .update(Lead)
    .set({ stage: target.key, history: jsonPush(Lead.history, historyEntry(user, "stage", { from, to: target.key })) })
    .where(eq(Lead._id, lead._id));
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
export async function closePendingFollowUps(leadId: Id, outcome: string): Promise<void> {
  await db()
    .update(Activity)
    .set({ done: true, doneAt: new Date(), outcome })
    .where(and(eq(Activity.lead, leadId), eq(Activity.type, "follow_up"), eq(Activity.done, false)));
}

/**
 * Marks a lead won: ensures it has a client (created from the lead when missing, status active),
 * moves it to the "won" stage and links the proposal when given. Idempotent for already-won leads.
 */
export async function closeLeadWon(
  user: Actor,
  leadId: Id,
  opts: { proposalId?: Id; summary?: string } = {},
): Promise<{ clientId: string; clientNo: string; createdClient: boolean }> {
  const settings = await getSettings();
  const won = firstStageOf(settings.pipelineStages, "won");
  if (!won) throw new ActionError("No \"won\" pipeline stage is configured. Ask an administrator to add one in Configuration.");

  const [lead] = await db().select().from(Lead).where(eq(Lead._id, leadId)).limit(1);
  if (!lead) throw new ActionError("This lead no longer exists.");
  if (lead.status === "lost") throw new ActionError("This lead was marked lost. Reopen it before marking it won.");

  let client: IClient | undefined;
  if (lead.client) [client] = await db().select().from(Client).where(eq(Client._id, lead.client)).limit(1);
  let createdClient = false;
  if (!client) {
    client = await createClientFromLead(user, lead, "active");
    createdClient = true;
  } else if (client.status !== "active") {
    await db().update(Client).set({ status: "active" }).where(eq(Client._id, client._id));
  }

  const set: SQLiteUpdateSetSource<typeof Lead> = {};
  if (createdClient) set.client = client._id;
  if (opts.proposalId) set.proposal = opts.proposalId;
  if (lead.status === "open") {
    const from = lead.stage;
    const now = new Date();
    set.stage = won.key;
    set.status = "won";
    set.closedAt = now;
    set.convertedAt = now;
    set.nextFollowUp = null;
    set.lostReason = null;
    set.history = jsonPush(Lead.history, historyEntry(user, "won", { from, to: won.key, note: opts.summary }));
  }
  if (Object.keys(set).length > 0) await db().update(Lead).set(set).where(eq(Lead._id, lead._id));

  await db().update(Activity).set({ client: client._id }).where(and(eq(Activity.lead, lead._id), isNull(Activity.client)));
  await closePendingFollowUps(lead._id, "Lead won");
  await audit(user, {
    action: "status",
    entity: "lead",
    entityId: lead._id,
    ref: lead.leadNo,
    summary: `Marked ${lead.leadNo} won${createdClient ? ` and created client ${client.clientNo}` : ""}`,
  });
  return { clientId: client._id, clientNo: client.clientNo, createdClient };
}

/**
 * Keeps `lead.nextFollowUp` in step with the lead's pending follow-up activities: it becomes the
 * earliest pending due date (a still-future date set on the lead itself is kept as a candidate).
 * Pass `completed` when a follow-up has just been finished so that date is dropped.
 */
export async function refreshNextFollowUp(leadId: Id, completed?: Date | null): Promise<void> {
  const [lead] = await db().select({ nextFollowUp: Lead.nextFollowUp, status: Lead.status }).from(Lead).where(eq(Lead._id, leadId)).limit(1);
  if (!lead || lead.status !== "open") return;
  const pending = await db()
    .select({ dueAt: Activity.dueAt })
    .from(Activity)
    .where(and(eq(Activity.lead, leadId), eq(Activity.type, "follow_up"), eq(Activity.done, false)));
  const dates = pending.map((p) => p.dueAt).filter((d): d is Date => Boolean(d));
  const current = lead.nextFollowUp ?? undefined;
  const keepCurrent = current && !(completed && current.getTime() === completed.getTime());
  if (keepCurrent && current.getTime() > Date.now()) dates.push(current);
  const next = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : keepCurrent ? current : undefined;
  if (next?.getTime() === current?.getTime()) return;
  await db().update(Lead).set({ nextFollowUp: next ?? null }).where(eq(Lead._id, leadId));
}
