import "server-only";
import type { Types } from "mongoose";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { Activity, Client, Contract, Lead, Proposal, type HistoryEntry, type ProposalStatus } from "@/lib/models";
import { notify, usersWithPermission } from "@/lib/notify";
import { addDays, diffDays, endOfDay, fmtDate, fmtDateTime, startOfDay, todayKey } from "@/lib/time";
import type { Job } from "./registry";

const BATCH = 500;
const system = (action: string, note?: string): HistoryEntry => ({ action, byName: "System", at: new Date(), note });

type ContractRef = { client: Types.ObjectId; createdBy?: Types.ObjectId };

/** Contract reminders: for a restricted client (FRS §3.2) only managers who may see it, plus the contract's creator. */
async function contractRecipients(contracts: ContractRef[]): Promise<(c: ContractRef) => (Types.ObjectId | string | undefined)[]> {
  const [managers, privileged, clients] = await Promise.all([
    usersWithPermission("contracts.manage"),
    usersWithPermission("crm.confidential"),
    Client.find({ _id: { $in: contracts.map((c) => c.client) }, confidential: true }, { _id: 1 }).lean(),
  ]);
  const restricted = new Set(clients.map((c) => c._id.toString()));
  const allowed = new Set(privileged);
  return (c) => [c.createdBy, ...(restricted.has(c.client.toString()) ? managers.filter((m) => allowed.has(m)) : managers)];
}

/** Follow-up activities that are due within the next hour (or overdue) and haven't been reminded yet. */
async function followUpReminders(): Promise<string> {
  await connectDB();
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 60_000);
  const due = await Activity.find({ type: "follow_up", done: false, dueAt: { $ne: null, $lte: horizon }, reminderSentAt: null }).limit(BATCH).lean();
  for (const a of due) {
    const overdue = Boolean(a.dueAt && a.dueAt < now);
    await notify([a.assignedTo ?? a.by, a.by], {
      type: "crm",
      title: `${overdue ? "Follow-up overdue" : "Follow-up due soon"}: ${a.subject}`,
      body: `Due ${fmtDateTime(a.dueAt)}`,
      link: a.lead ? `/crm/leads/${a.lead}` : a.client ? `/crm/clients/${a.client}` : "/crm",
      priority: overdue ? "high" : "normal",
      dedupeKey: `followup:${a._id}`,
      actionable: true,
    });
    await Activity.updateOne({ _id: a._id }, { $set: { reminderSentAt: new Date() } });
  }
  return `${due.length} follow-up reminder(s)`;
}

/** Open leads whose next follow-up is today or earlier — one reminder per lead per day. */
async function leadFollowUpsDue(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const start = startOfDay(today);
  const leads = await Lead.find({ status: "open", nextFollowUp: { $ne: null, $lte: endOfDay(today) } }).limit(BATCH).lean();
  for (const l of leads) {
    const overdue = Boolean(l.nextFollowUp && l.nextFollowUp < start);
    await notify([l.assignedTo ?? l.createdBy], {
      type: "crm",
      title: overdue ? `Lead follow-up overdue: ${l.title}` : `Lead follow-up due today: ${l.title}`,
      body: `${l.companyName} · ${fmtDateTime(l.nextFollowUp)}`,
      link: `/crm/leads/${l._id}`,
      priority: overdue ? "high" : "normal",
      dedupeKey: `lead-followup:${l._id}:${today}`,
      actionable: true,
    });
  }
  return `${leads.length} lead follow-up(s) due`;
}

/** Sent / negotiation proposals past their validity expire; those expiring within 3 days get a heads-up. */
async function proposalExpiry(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const open: ProposalStatus[] = ["sent", "negotiation"];

  const expired = await Proposal.find({ status: { $in: open }, validUntil: { $lt: today } }).limit(BATCH).lean();
  let expiredCount = 0;
  for (const p of expired) {
    const res = await Proposal.updateOne(
      { _id: p._id, status: { $in: open } },
      { $set: { status: "expired" }, $push: { history: system("expired", `Validity ended ${p.validUntil}`) } },
    );
    if (res.modifiedCount === 0) continue;
    expiredCount++;
    await audit(null, { action: "status", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `${p.proposalNo} expired (valid until ${p.validUntil})`, changes: [{ field: "status", from: p.status, to: "expired" }] });
    await notify([p.owner ?? p.createdBy], {
      type: "contract",
      title: `Proposal expired: ${p.title}`,
      body: `${p.proposalNo} was valid until ${fmtDate(p.validUntil)}. Reopen it to revise and send again.`,
      link: `/proposals/${p._id}`,
      dedupeKey: `proposal-expired:${p._id}`,
    });
  }

  const soon = await Proposal.find({ status: { $in: open }, validUntil: { $gte: today, $lte: addDays(today, 3) } }).limit(BATCH).lean();
  for (const p of soon) {
    const left = p.validUntil ? diffDays(today, p.validUntil) : 0;
    await notify([p.owner ?? p.createdBy], {
      type: "contract",
      title: left === 0 ? `Proposal expires today: ${p.title}` : `Proposal expires in ${left} day${left === 1 ? "" : "s"}: ${p.title}`,
      body: `${p.proposalNo} · valid until ${fmtDate(p.validUntil)}`,
      link: `/proposals/${p._id}`,
      priority: "high",
      dedupeKey: `proposal-expiring:${p._id}:${p.validUntil}`,
      actionable: true,
    });
  }
  return `${expiredCount} expired, ${soon.length} expiring soon`;
}

/** Active contracts inside their renewal window get one reminder (creator + contract managers). */
async function contractRenewals(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const candidates = await Contract.find({ status: "active", endDate: { $gte: today }, reminderSentAt: null }).limit(BATCH).lean();
  const due = candidates.filter((c) => c.endDate && diffDays(today, c.endDate) <= c.renewalReminderDays);
  if (due.length === 0) return "0 renewal reminder(s)";
  const recipients = await contractRecipients(due);
  for (const c of due) {
    const left = diffDays(today, c.endDate as string);
    await notify(recipients(c), {
      type: "contract",
      title: left === 0 ? `Contract ends today: ${c.title}` : `Contract ends in ${left} day${left === 1 ? "" : "s"}: ${c.title}`,
      body: `${c.contractNo} ends ${fmtDate(c.endDate)}${c.autoRenew ? " (auto-renew is on — create the renewal from the contract page)" : ". Renew it or let it lapse."}`,
      link: `/contracts/${c._id}`,
      priority: left <= 7 ? "high" : "normal",
      dedupeKey: `contract-renewal:${c._id}:${c.endDate}`,
      actionable: true,
    });
    await Contract.updateOne({ _id: c._id }, { $set: { reminderSentAt: new Date() } });
  }
  return `${due.length} renewal reminder(s)`;
}

/** Active contracts whose end date has passed are marked expired. */
async function contractExpiry(): Promise<string> {
  await connectDB();
  const today = todayKey();
  const lapsed = await Contract.find({ status: "active", endDate: { $lt: today } }).limit(BATCH).lean();
  if (lapsed.length === 0) return "0 contract(s) expired";
  const recipients = await contractRecipients(lapsed);
  let count = 0;
  for (const c of lapsed) {
    const res = await Contract.updateOne({ _id: c._id, status: "active" }, { $set: { status: "expired" }, $push: { history: system("expired", `Ended ${c.endDate}`) } });
    if (res.modifiedCount === 0) continue;
    count++;
    await audit(null, { action: "status", entity: "contract", entityId: c._id, ref: c.contractNo, summary: `${c.contractNo} expired (ended ${c.endDate})`, changes: [{ field: "status", from: "active", to: "expired" }] });
    await notify(recipients(c), {
      type: "contract",
      title: `Contract expired: ${c.title}`,
      body: `${c.contractNo} ended ${fmtDate(c.endDate)}.${c.autoRenew ? " Auto-renew is on — create the renewal from the contract page." : " Renew it if the engagement continues."}`,
      link: `/contracts/${c._id}`,
      dedupeKey: `contract-expired:${c._id}`,
    });
  }
  return `${count} contract(s) expired`;
}

export const salesJobs: Job[] = [
  { name: "sales-followup-reminders", intervalMinutes: 10, run: followUpReminders },
  { name: "sales-lead-followups-due", intervalMinutes: 60, run: leadFollowUpsDue },
  { name: "sales-proposal-expiry", intervalMinutes: 60, run: proposalExpiry },
  { name: "sales-contract-renewals", intervalMinutes: 180, run: contractRenewals },
  { name: "sales-contract-expiry", intervalMinutes: 180, run: contractExpiry },
];
