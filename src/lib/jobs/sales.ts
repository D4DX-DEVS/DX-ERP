import "server-only";
import { and, eq, gte, isNull, lt, lte } from "drizzle-orm";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { Activity, Client, Contract, Lead, newId, Proposal, type HistoryEntry, type Id, type ProposalStatus } from "@/lib/models";
import { usersWithPermission } from "@/lib/notify";
import { inList, jsonPush } from "@/lib/sql";
import { addDays, diffDays, endOfDay, fmtDate, fmtDateTime, startOfDay, todayKey } from "@/lib/time";
import { notifyBatch, runGuardedUpdates, type BatchedNotification } from "./batch";
import type { Job } from "./registry";

const BATCH = 500;
const system = (action: string, note?: string): HistoryEntry => ({ _id: newId(), action, byName: "System", at: new Date(), note });

type ContractRef = { client: Id; createdBy?: Id | null };

/** Contract reminders: for a restricted client (FRS §3.2) only managers who may see it, plus the contract's creator. */
async function contractRecipients(contracts: ContractRef[]): Promise<(c: ContractRef) => (Id | null | undefined)[]> {
  const [managers, privileged, clients] = await Promise.all([
    usersWithPermission("contracts.manage"),
    usersWithPermission("crm.confidential"),
    db()
      .select({ id: Client._id })
      .from(Client)
      .where(and(inList(Client._id, [...new Set(contracts.map((c) => c.client))]), eq(Client.confidential, true))),
  ]);
  const restricted = new Set(clients.map((c) => c.id));
  const allowed = new Set(privileged);
  return (c) => [c.createdBy, ...(restricted.has(c.client) ? managers.filter((m) => allowed.has(m)) : managers)];
}

/** Follow-up activities that are due within the next hour (or overdue) and haven't been reminded yet. */
async function followUpReminders(): Promise<string> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 60_000);
  const due = await db()
    .select({ id: Activity._id, subject: Activity.subject, dueAt: Activity.dueAt, assignedTo: Activity.assignedTo, by: Activity.by, lead: Activity.lead, client: Activity.client })
    .from(Activity)
    .where(and(eq(Activity.type, "follow_up"), eq(Activity.done, false), lte(Activity.dueAt, horizon), isNull(Activity.reminderSentAt)))
    .limit(BATCH);
  if (due.length === 0) return "0 follow-up reminder(s)";
  await notifyBatch(
    due.map((a) => {
      const overdue = Boolean(a.dueAt && a.dueAt < now);
      return {
        recipients: [a.assignedTo ?? a.by, a.by],
        input: {
          type: "crm",
          title: `${overdue ? "Follow-up overdue" : "Follow-up due soon"}: ${a.subject}`,
          body: `Due ${fmtDateTime(a.dueAt)}`,
          link: a.lead ? `/crm/leads/${a.lead}` : a.client ? `/crm/clients/${a.client}` : "/crm",
          priority: overdue ? ("high" as const) : ("normal" as const),
          dedupeKey: `followup:${a.id}`,
          actionable: true,
        },
      };
    }),
  );
  await db()
    .update(Activity)
    .set({ reminderSentAt: new Date() })
    .where(inList(Activity._id, due.map((a) => a.id)));
  return `${due.length} follow-up reminder(s)`;
}

/** Open leads whose next follow-up is today or earlier — one reminder per lead per day. */
async function leadFollowUpsDue(): Promise<string> {
  const today = todayKey();
  const start = startOfDay(today);
  const leads = await db()
    .select({ id: Lead._id, title: Lead.title, companyName: Lead.companyName, nextFollowUp: Lead.nextFollowUp, assignedTo: Lead.assignedTo, createdBy: Lead.createdBy })
    .from(Lead)
    .where(and(eq(Lead.status, "open"), lte(Lead.nextFollowUp, endOfDay(today))))
    .limit(BATCH);
  await notifyBatch(
    leads.map((l) => {
      const overdue = Boolean(l.nextFollowUp && l.nextFollowUp < start);
      return {
        recipients: [l.assignedTo ?? l.createdBy],
        input: {
          type: "crm",
          title: overdue ? `Lead follow-up overdue: ${l.title}` : `Lead follow-up due today: ${l.title}`,
          body: `${l.companyName} · ${fmtDateTime(l.nextFollowUp)}`,
          link: `/crm/leads/${l.id}`,
          priority: overdue ? ("high" as const) : ("normal" as const),
          dedupeKey: `lead-followup:${l.id}:${today}`,
          actionable: true,
        },
      };
    }),
  );
  return `${leads.length} lead follow-up(s) due`;
}

/** Sent / negotiation proposals past their validity expire; those expiring within 3 days get a heads-up. */
async function proposalExpiry(): Promise<string> {
  const today = todayKey();
  const open: ProposalStatus[] = ["sent", "negotiation"];
  const columns = { id: Proposal._id, proposalNo: Proposal.proposalNo, title: Proposal.title, status: Proposal.status, validUntil: Proposal.validUntil, owner: Proposal.owner, createdBy: Proposal.createdBy };

  const expired = await db()
    .select(columns)
    .from(Proposal)
    .where(and(inList(Proposal.status, open), lt(Proposal.validUntil, today)))
    .limit(BATCH);
  // Each proposal is flipped only if it is still open (guarded); the ids that matched are the ones we announce.
  const flipped = await runGuardedUpdates(
    expired.map((p) =>
      db()
        .update(Proposal)
        .set({ status: "expired", history: jsonPush(Proposal.history, system("expired", `Validity ended ${p.validUntil}`)) })
        .where(and(eq(Proposal._id, p.id), inList(Proposal.status, open)))
        .returning({ id: Proposal._id }),
    ),
  );
  const items: BatchedNotification[] = [];
  for (const p of expired) {
    if (!flipped.has(p.id)) continue;
    await audit(null, { action: "status", entity: "proposal", entityId: p.id, ref: p.proposalNo, summary: `${p.proposalNo} expired (valid until ${p.validUntil})`, changes: [{ field: "status", from: p.status, to: "expired" }] });
    items.push({
      recipients: [p.owner ?? p.createdBy],
      input: {
        type: "contract",
        title: `Proposal expired: ${p.title}`,
        body: `${p.proposalNo} was valid until ${fmtDate(p.validUntil)}. Reopen it to revise and send again.`,
        link: `/proposals/${p.id}`,
        dedupeKey: `proposal-expired:${p.id}`,
      },
    });
  }

  const soon = await db()
    .select(columns)
    .from(Proposal)
    .where(and(inList(Proposal.status, open), gte(Proposal.validUntil, today), lte(Proposal.validUntil, addDays(today, 3))))
    .limit(BATCH);
  for (const p of soon) {
    const left = p.validUntil ? diffDays(today, p.validUntil) : 0;
    items.push({
      recipients: [p.owner ?? p.createdBy],
      input: {
        type: "contract",
        title: left === 0 ? `Proposal expires today: ${p.title}` : `Proposal expires in ${left} day${left === 1 ? "" : "s"}: ${p.title}`,
        body: `${p.proposalNo} · valid until ${fmtDate(p.validUntil)}`,
        link: `/proposals/${p.id}`,
        priority: "high",
        dedupeKey: `proposal-expiring:${p.id}:${p.validUntil}`,
        actionable: true,
      },
    });
  }
  await notifyBatch(items);
  return `${flipped.size} expired, ${soon.length} expiring soon`;
}

/** Active contracts inside their renewal window get one reminder (creator + contract managers). */
async function contractRenewals(): Promise<string> {
  const today = todayKey();
  const candidates = await db()
    .select({ id: Contract._id, contractNo: Contract.contractNo, title: Contract.title, client: Contract.client, createdBy: Contract.createdBy, endDate: Contract.endDate, renewalReminderDays: Contract.renewalReminderDays, autoRenew: Contract.autoRenew })
    .from(Contract)
    .where(and(eq(Contract.status, "active"), gte(Contract.endDate, today), isNull(Contract.reminderSentAt)))
    .limit(BATCH);
  const due = candidates.filter((c) => c.endDate && diffDays(today, c.endDate) <= c.renewalReminderDays);
  if (due.length === 0) return "0 renewal reminder(s)";
  const recipients = await contractRecipients(due);
  await notifyBatch(
    due.map((c) => {
      const left = diffDays(today, c.endDate as string);
      return {
        recipients: recipients(c),
        input: {
          type: "contract",
          title: left === 0 ? `Contract ends today: ${c.title}` : `Contract ends in ${left} day${left === 1 ? "" : "s"}: ${c.title}`,
          body: `${c.contractNo} ends ${fmtDate(c.endDate)}${c.autoRenew ? " (auto-renew is on — create the renewal from the contract page)" : ". Renew it or let it lapse."}`,
          link: `/contracts/${c.id}`,
          priority: left <= 7 ? ("high" as const) : ("normal" as const),
          dedupeKey: `contract-renewal:${c.id}:${c.endDate}`,
          actionable: true,
        },
      };
    }),
  );
  await db()
    .update(Contract)
    .set({ reminderSentAt: new Date() })
    .where(inList(Contract._id, due.map((c) => c.id)));
  return `${due.length} renewal reminder(s)`;
}

/** Active contracts whose end date has passed are marked expired. */
async function contractExpiry(): Promise<string> {
  const today = todayKey();
  const lapsed = await db()
    .select({ id: Contract._id, contractNo: Contract.contractNo, title: Contract.title, client: Contract.client, createdBy: Contract.createdBy, endDate: Contract.endDate, autoRenew: Contract.autoRenew })
    .from(Contract)
    .where(and(eq(Contract.status, "active"), lt(Contract.endDate, today)))
    .limit(BATCH);
  if (lapsed.length === 0) return "0 contract(s) expired";
  const recipients = await contractRecipients(lapsed);
  const flipped = await runGuardedUpdates(
    lapsed.map((c) =>
      db()
        .update(Contract)
        .set({ status: "expired", history: jsonPush(Contract.history, system("expired", `Ended ${c.endDate}`)) })
        .where(and(eq(Contract._id, c.id), eq(Contract.status, "active")))
        .returning({ id: Contract._id }),
    ),
  );
  const items: BatchedNotification[] = [];
  for (const c of lapsed) {
    if (!flipped.has(c.id)) continue;
    await audit(null, { action: "status", entity: "contract", entityId: c.id, ref: c.contractNo, summary: `${c.contractNo} expired (ended ${c.endDate})`, changes: [{ field: "status", from: "active", to: "expired" }] });
    items.push({
      recipients: recipients(c),
      input: {
        type: "contract",
        title: `Contract expired: ${c.title}`,
        body: `${c.contractNo} ended ${fmtDate(c.endDate)}.${c.autoRenew ? " Auto-renew is on — create the renewal from the contract page." : " Renew it if the engagement continues."}`,
        link: `/contracts/${c.id}`,
        dedupeKey: `contract-expired:${c.id}`,
      },
    });
  }
  await notifyBatch(items);
  return `${flipped.size} contract(s) expired`;
}

export const salesJobs: Job[] = [
  { name: "sales-followup-reminders", intervalMinutes: 10, run: followUpReminders },
  { name: "sales-lead-followups-due", intervalMinutes: 60, run: leadFollowUpsDue },
  { name: "sales-proposal-expiry", intervalMinutes: 60, run: proposalExpiry },
  { name: "sales-contract-renewals", intervalMinutes: 180, run: contractRenewals },
  { name: "sales-contract-expiry", intervalMinutes: 180, run: contractExpiry },
];
