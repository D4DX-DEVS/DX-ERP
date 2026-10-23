"use server";

import { z } from "zod";
import { Types } from "mongoose";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { Client, Lead, Project, Proposal, User, type HistoryEntry, type ProposalContent } from "@/lib/models";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { zs } from "@/lib/validation";
import { actionClient, actionLead } from "@/app/(app)/crm/_lib/access";
import { closeLeadWon, ensureLeadClient, historyEntry, setOpenStage } from "@/app/(app)/crm/_lib/leads";
import { findOpenStage } from "@/app/(app)/crm/_lib/pipeline";
import { actionProposal } from "./_lib/access";
import { computeTotals, percentSum, scheduleAmounts } from "./_lib/calc";
import { contentOf } from "./_lib/content";

const deliverables = z.preprocess(
  (v) => {
    if (v == null || v === "") return [];
    const arr = Array.isArray(v) ? v : String(v).split(/\r?\n/);
    return arr.map((x) => String(x).trim()).filter(Boolean);
  },
  z.array(z.string().max(500, "Each deliverable must be under 500 characters")).max(50, "At most 50 deliverables"),
);

const itemSchema = z.object({
  description: zs.text("Description", 500),
  quantity: zs.num("Quantity", { min: 0 }),
  rate: zs.num("Rate", { min: 0 }),
  taxRate: zs.num("Tax rate", { min: 0, max: 100 }),
});

const milestoneSchema = z.object({
  title: zs.text("Milestone title", 200),
  percent: zs.num("Percent", { min: 0, max: 100 }),
  dueOn: zs.optDate(),
});

const contentFields = {
  kind: z.enum(["proposal", "quotation"], { error: "Choose proposal or quotation" }),
  title: zs.text("Title", 200),
  summary: zs.optText(5000),
  scope: zs.optText(20000),
  deliverables,
  timeline: zs.optText(2000),
  startDate: zs.optDate(),
  endDate: zs.optDate(),
  items: z.array(itemSchema, { error: "Add at least one line item" }).min(1, "Add at least one line item"),
  discount: zs.optNum({ min: 0 }),
  paymentMilestones: z.array(milestoneSchema).default([]),
  terms: zs.optText(20000),
  validUntil: zs.date("Valid until"),
  revisionNote: zs.optText(500),
};

const createSchema = z.object({ ...contentFields, client: zs.optId(), lead: zs.optId() });
const updateSchema = z.object({ ...contentFields, client: zs.optId() });

type ContentInput = z.infer<typeof updateSchema>;

/** Validates cross-field rules and recomputes every amount on the server. */
function buildContent(data: ContentInput): ProposalContent {
  if (data.startDate && data.endDate && data.endDate < data.startDate) {
    throw new ActionError("The end date is before the start date.", { endDate: "End date must be on or after the start date" });
  }
  const totals = computeTotals(data.items, data.discount ?? 0);
  if ((data.discount ?? 0) > totals.subtotal) {
    throw new ActionError("The discount is more than the subtotal.", { discount: "Discount can't exceed the subtotal" });
  }
  const milestones = data.paymentMilestones;
  if (milestones.length > 0) {
    const sum = percentSum(milestones.map((m) => m.percent));
    if (Math.abs(sum - 100) > 0.01) {
      throw new ActionError(`Payment milestones add up to ${sum}%. They must total 100%.`, { paymentMilestones: "Milestone percentages must add up to 100%" });
    }
  }
  const amounts = scheduleAmounts(totals.total, milestones.map((m) => m.percent));
  return {
    title: data.title,
    summary: data.summary,
    scope: data.scope,
    deliverables: data.deliverables,
    timeline: data.timeline,
    startDate: data.startDate,
    endDate: data.endDate,
    items: totals.items,
    discount: totals.discount,
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    paymentMilestones: milestones.map((m, i) => ({ title: m.title, percent: m.percent, amount: amounts[i], dueOn: m.dueOn })),
    terms: data.terms,
    validUntil: data.validUntil,
  };
}

const hist = (user: { _id: Types.ObjectId; name: string }, action: string, note?: string): HistoryEntry => historyEntry(user, action, { note });

export async function createProposal(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.manage");
    const data = parse(createSchema, input);
    const content = buildContent(data);

    let lead = data.lead ? await actionLead(user, data.lead) : null;
    if (lead?.status === "lost") throw new ActionError("This lead was marked lost. Reopen it before raising a proposal.");
    let clientId = data.client;
    if (!clientId && lead) {
      // A lead that isn't a client yet gets a prospect client so the proposal has someone to address.
      clientId = lead.client ? lead.client.toString() : (await ensureLeadClient(user, lead._id, "prospect")).client._id.toString();
    }
    if (!clientId) throw new ActionError("Choose a client for this proposal.", { client: "Choose a client" });
    const client = await actionClient(user, clientId);
    if (lead?.client && lead.client.toString() !== client._id.toString()) throw new ActionError("This lead belongs to a different client.", { client: "Doesn't match the lead's client" });
    if (lead && !lead.client) {
      await Lead.updateOne({ _id: lead._id }, { $set: { client: client._id } });
      lead = await actionLead(user, lead._id.toString());
    }

    const settings = await getSettings();
    const proposalNo = await nextNumber("proposal", settings.numbering.proposalPrefix, 4);
    const doc = await Proposal.create({
      proposalNo,
      kind: data.kind,
      version: 1,
      client: client._id,
      lead: lead?._id,
      ...content,
      status: "draft",
      owner: lead?.assignedTo ?? user._id,
      createdBy: user._id,
      history: [hist(user, "created")],
    });
    if (lead) await Lead.updateOne({ _id: lead._id }, { $set: { proposal: doc._id } });
    await audit(user, {
      action: "create",
      entity: "proposal",
      entityId: doc._id,
      ref: proposalNo,
      summary: `Created ${data.kind} ${proposalNo}: ${content.title} for ${client.name}`,
    });
    return { id: doc._id.toString() };
  }, "Proposal saved");
}

export async function updateProposal(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.manage");
    await actionProposal(user, id);
    const data = parse(updateSchema, input);
    const content = buildContent(data);
    const proposal = await Proposal.findById(id);
    if (!proposal) throw new ActionError("This proposal no longer exists.");
    if (proposal.status !== "draft" && proposal.status !== "negotiation") {
      throw new ActionError("Only draft or negotiation proposals can be edited.");
    }

    if (proposal.status === "draft" && data.client && data.client !== proposal.client.toString()) {
      const client = await actionClient(user, data.client);
      proposal.client = client._id;
    }

    const wasSent = Boolean(proposal.sentAt);
    const previousTotal = proposal.total;
    if (wasSent) {
      // Keep the version the client has seen; the edit becomes the next version.
      proposal.revisions.push({ version: proposal.version, snapshot: contentOf(proposal), note: data.revisionNote, by: user._id, byName: user.name, at: new Date() });
      proposal.version += 1;
    }
    proposal.kind = data.kind;
    proposal.title = content.title;
    proposal.summary = content.summary;
    proposal.scope = content.scope;
    proposal.deliverables = content.deliverables;
    proposal.timeline = content.timeline;
    proposal.startDate = content.startDate;
    proposal.endDate = content.endDate;
    proposal.set("items", content.items);
    proposal.discount = content.discount;
    proposal.subtotal = content.subtotal;
    proposal.taxTotal = content.taxTotal;
    proposal.total = content.total;
    proposal.set("paymentMilestones", content.paymentMilestones);
    proposal.terms = content.terms;
    proposal.validUntil = content.validUntil;
    proposal.history.push(hist(user, wasSent ? "revised" : "updated", wasSent ? `Version ${proposal.version}${data.revisionNote ? ` — ${data.revisionNote}` : ""}` : undefined));
    await proposal.save();

    await audit(user, {
      action: "update",
      entity: "proposal",
      entityId: proposal._id,
      ref: proposal.proposalNo,
      summary: wasSent ? `Revised ${proposal.proposalNo} to version ${proposal.version}` : `Updated ${proposal.proposalNo}`,
      changes: diff({ total: previousTotal }, { total: proposal.total }, ["total"], ["total"]),
    });
    return { id: proposal._id.toString() };
  }, "Proposal saved");
}

/* ------------------------------------------------------------ status changes */

export async function sendProposal(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.manage");
    const p = await actionProposal(user, id);
    if (p.status !== "draft" && p.status !== "negotiation") throw new ActionError("Only draft or negotiation proposals can be sent.");
    if (p.items.length === 0) throw new ActionError("Add at least one line item before sending.");
    if (!p.validUntil || p.validUntil < todayKey()) throw new ActionError("The validity date has passed. Update \"Valid until\" before sending.");

    await Proposal.updateOne({ _id: id }, { $set: { status: "sent", sentAt: new Date() }, $push: { history: hist(user, "sent") } });
    if (p.lead) {
      const settings = await getSettings();
      const stage = findOpenStage(settings.pipelineStages, ["proposal_sent"], /proposal sent/i);
      if (stage) await setOpenStage(user, p.lead, stage.key, { onlyForward: true });
    }
    await audit(user, { action: "status", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `Sent ${p.proposalNo} to the client`, changes: [{ field: "status", from: p.status, to: "sent" }] });
    await notify([p.owner], { type: "crm", title: `Proposal sent: ${p.title}`, body: p.proposalNo, link: `/proposals/${id}` }, [user._id]);
    return null;
  }, "Marked as sent");
}

export async function startNegotiation(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.manage");
    const p = await actionProposal(user, id);
    if (p.status !== "sent") throw new ActionError("Only sent proposals can move to negotiation.");
    await Proposal.updateOne({ _id: id }, { $set: { status: "negotiation" }, $push: { history: hist(user, "negotiation") } });
    await audit(user, { action: "status", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `${p.proposalNo} moved to negotiation`, changes: [{ field: "status", from: "sent", to: "negotiation" }] });
    return null;
  }, "Moved to negotiation");
}

const noteSchema = z.object({ note: zs.optText(2000) });
const reasonSchema = z.object({ reason: zs.text("Reason", 2000) });

export async function approveProposal(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.approve");
    const p = await actionProposal(user, id);
    const data = parse(noteSchema, { note });
    if (p.status !== "sent" && p.status !== "negotiation") throw new ActionError("Only sent proposals can be approved.");

    // Close the lead first: if it can't be marked won (e.g. it was lost) the proposal stays untouched.
    if (p.lead) {
      await closeLeadWon(user, p.lead, { proposalId: p._id, summary: `Proposal ${p.proposalNo} approved` });
    } else {
      await Client.updateOne({ _id: p.client, status: { $in: ["lead", "prospect", "inactive"] } }, { $set: { status: "active" } });
    }
    const res = await Proposal.updateOne(
      { _id: id, status: { $in: ["sent", "negotiation"] } },
      {
        $set: { status: "approved", decidedAt: new Date(), decisionNote: data.note, approvedBy: user._id, approvedByName: user.name },
        $push: { history: hist(user, "approved", data.note) },
      },
    );
    if (res.modifiedCount === 0) throw new ActionError("This proposal was already decided.");
    await audit(user, { action: "approve", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `Approved ${p.proposalNo} (client accepted)`, changes: [{ field: "status", from: p.status, to: "approved" }] });
    await notify([p.owner, p.createdBy], { type: "crm", title: `Proposal approved: ${p.title}`, body: `${p.proposalNo} — ready to convert to a project`, link: `/proposals/${id}` }, [user._id]);
    return null;
  }, "Proposal approved");
}

export async function rejectProposal(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.approve", "proposals.manage");
    const p = await actionProposal(user, id);
    const data = parse(reasonSchema, { reason });
    if (p.status !== "sent" && p.status !== "negotiation") throw new ActionError("Only sent proposals can be rejected.");
    await Proposal.updateOne(
      { _id: id },
      { $set: { status: "rejected", decidedAt: new Date(), decisionNote: data.reason }, $push: { history: hist(user, "rejected", data.reason) } },
    );
    await audit(user, { action: "reject", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `Rejected ${p.proposalNo}: ${data.reason}`, changes: [{ field: "status", from: p.status, to: "rejected" }] });
    await notify([p.owner, p.createdBy], { type: "crm", title: `Proposal rejected: ${p.title}`, body: data.reason, link: `/proposals/${id}` }, [user._id]);
    return null;
  }, "Proposal marked rejected");
}

/** Rejected or expired proposals go back to negotiation so they can be revised and re-sent. */
export async function reopenProposal(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.manage");
    const p = await actionProposal(user, id);
    if (p.status !== "rejected" && p.status !== "expired") throw new ActionError("Only rejected or expired proposals can be reopened.");
    await Proposal.updateOne({ _id: id }, { $set: { status: "negotiation", decidedAt: null, decisionNote: null }, $push: { history: hist(user, "reopened") } });
    await audit(user, { action: "status", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `Reopened ${p.proposalNo} for negotiation`, changes: [{ field: "status", from: p.status, to: "negotiation" }] });
    return null;
  }, "Proposal reopened");
}

/* ------------------------------------------------------ proposal → project */

const convertSchema = z.object({ manager: zs.id("Project manager") });

export async function convertToProject(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("proposals.approve");
    const p = await actionProposal(user, id);
    const data = parse(convertSchema, input);
    if (p.project || p.status === "converted") throw new ActionError("This proposal has already been converted to a project.");
    if (p.status !== "approved") throw new ActionError("Only approved proposals can be converted to a project.");

    const manager = await User.findById(data.manager, { name: 1, personType: 1, status: 1, accountActive: 1 }).lean();
    if (!manager) throw new ActionError("The selected project manager no longer exists.", { manager: "Choose a project manager" });
    if (!["employee", "trainee", "intern"].includes(manager.personType) || EXITED_STATUSES.includes(manager.status) || !manager.accountActive) {
      throw new ActionError("Choose an active staff member as the project manager.", { manager: "Choose an active staff member" });
    }
    const settings = await getSettings();
    const planning = settings.projectStatuses.find((s) => s.category === "planning");
    if (!planning) throw new ActionError("No project status in the \"planning\" category is configured. Ask an administrator to add one in Configuration.");

    // Claim the proposal atomically so a double click can't create two projects.
    const claimed = await Proposal.findOneAndUpdate({ _id: id, status: "approved", project: null }, { $set: { status: "converted" } }, { returnDocument: "after" });
    if (!claimed) throw new ActionError("This proposal has already been converted to a project.");

    try {
      const projectNo = await nextNumber("project", ID_PREFIX.project, 4);
      const project = await Project.create({
        projectNo,
        title: p.title,
        client: p.client,
        internal: false,
        description: p.summary,
        scope: p.scope,
        deliverables: p.deliverables,
        manager: manager._id,
        startDate: p.startDate,
        targetDate: p.endDate,
        budget: p.total,
        status: planning.key,
        proposal: p._id,
        milestones: p.paymentMilestones.map((m) => ({
          title: m.title,
          description: `${m.percent}% payment milestone`,
          dueDate: m.dueOn,
          status: "pending",
          amount: m.amount,
        })),
        history: [historyEntry(user, "created", { note: `Converted from ${p.proposalNo}` })],
        createdBy: user._id,
      });
      await Proposal.updateOne({ _id: id }, { $set: { project: project._id }, $push: { history: hist(user, "converted", `Project ${projectNo}`) } });
      if (p.lead) await Lead.updateOne({ _id: p.lead }, { $set: { project: project._id } });
      await audit(user, { action: "create", entity: "project", entityId: project._id, ref: projectNo, summary: `Created project ${projectNo} from proposal ${p.proposalNo}` });
      await audit(user, { action: "status", entity: "proposal", entityId: p._id, ref: p.proposalNo, summary: `Converted ${p.proposalNo} to project ${projectNo}`, changes: [{ field: "status", from: "approved", to: "converted" }] });
      await notify([manager._id], { type: "project", title: `You are the project manager: ${p.title}`, body: `${projectNo} was created from ${p.proposalNo}`, link: `/projects/${project._id}`, actionable: true }, [user._id]);
      return { id: project._id.toString() };
    } catch (error) {
      await Proposal.updateOne({ _id: id, project: null }, { $set: { status: "approved" } });
      throw error;
    }
  }, "Project created");
}
