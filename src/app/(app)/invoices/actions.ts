"use server";

import { z } from "zod";
import { runAction, actionPermission, ActionError, parse, type ActionResult } from "@/lib/actions";
import { zs, isObjectId } from "@/lib/validation";
import { audit, diff } from "@/lib/audit";
import { notify, notifyPermission, usersWithPermission } from "@/lib/notify";
import { ID_PREFIX, fiscalYear, nextNumber, nextSeq } from "@/lib/counters";
import { getSettings } from "@/lib/settings";
import { round2, inr } from "@/lib/format";
import { addDays, diffDays, todayKey, zonedDateTime } from "@/lib/time";
import { Client, Contract, Invoice, Payment, Project, type IInvoice } from "@/lib/models";
import type { Address } from "@/lib/models/_base";
import { balanceOf, computeTotals, CUSTOM_TERM, INVOICE_PAYMENT_METHODS, settledStatus } from "./totals";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";

const itemSchema = z.object({
  description: zs.text("Description", 500),
  quantity: zs.num("Quantity", { min: 0.01 }),
  rate: zs.num("Rate", { min: 0 }),
  taxRate: zs.num("Tax rate", { min: 0, max: 100 }),
});

const draftSchema = z.object({
  id: zs.optId(),
  client: zs.id("Client"),
  project: zs.optId(),
  contract: zs.optId(),
  milestone: zs.optId(),
  issueDate: zs.date("Issue date"),
  paymentTerm: zs.text("Payment term", 20),
  dueDate: zs.optDate(),
  discount: zs.optNum({ min: 0 }),
  placeOfSupply: zs.optText(100),
  notes: zs.optText(2000),
  terms: zs.optText(4000),
  items: z.array(itemSchema).min(1, "Add at least one line item").max(100, "Too many line items"),
});

const method = z.enum(INVOICE_PAYMENT_METHODS, { error: "Choose a payment method" });

const paymentSchema = z.object({
  date: zs.date("Date"),
  amount: zs.num("Amount", { min: 0.01 }),
  method,
  reference: zs.optText(120),
  note: zs.optText(500),
});

const refundSchema = z.object({
  date: zs.date("Date"),
  amount: zs.num("Amount", { min: 0.01 }),
  method,
  reference: zs.optText(120),
  note: zs.text("Reason", 500),
});

const adjustmentSchema = z.object({
  date: zs.date("Date"),
  amount: zs.num("Amount", { min: 0.01 }),
  note: zs.text("Note", 500),
});

function formatAddress(a?: Address): string | undefined {
  if (!a) return undefined;
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const text = [a.line1, a.line2, cityLine, a.country].filter(Boolean).join(", ");
  return text || undefined;
}

async function loadInvoice(id: string): Promise<IInvoice> {
  if (!isObjectId(id)) throw new ActionError("Invoice not found.");
  const inv = await Invoice.findById(id).lean();
  if (!inv) throw new ActionError("Invoice not found.");
  return inv;
}

const label = (inv: Pick<IInvoice, "invoiceNo" | "draftNo">) => inv.invoiceNo ?? inv.draftNo;

/** Create a draft invoice, or update an existing draft. Totals are always recomputed here. */
export async function saveInvoice(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("invoices.manage");
    const data = parse(draftSchema, input);

    const client = await Client.findById(data.client, { name: 1, confidential: 1, owner: 1 }).lean();
    if (!client || !canSeeClient(user, client)) throw new ActionError("Client not found.", { client: "Choose a client" });

    let projectDoc: { milestones: { _id: { toString(): string }; invoiced?: boolean; invoice?: { toString(): string } }[] } | null = null;
    if (data.project) {
      const p = await Project.findById(data.project, { client: 1, milestones: 1 }).lean();
      if (!p || p.client?.toString() !== data.client) throw new ActionError("That project does not belong to the selected client.", { project: "Choose one of this client's projects" });
      projectDoc = p;
    }
    if (data.contract) {
      const c = await Contract.findById(data.contract, { client: 1 }).lean();
      if (!c || c.client.toString() !== data.client) throw new ActionError("That contract does not belong to the selected client.", { contract: "Choose one of this client's contracts" });
    }
    if (data.milestone) {
      const m = projectDoc?.milestones.find((x) => x._id.toString() === data.milestone);
      if (!m) throw new ActionError("Milestone not found on the selected project.", { milestone: "Choose a milestone of the project" });
      if (m.invoiced && m.invoice?.toString() !== data.id) throw new ActionError("This milestone has already been invoiced.", { milestone: "Already invoiced" });
    }

    let paymentTermDays: number;
    let dueDate: string;
    if (data.paymentTerm === CUSTOM_TERM) {
      if (!data.dueDate) throw new ActionError("Enter a due date.", { dueDate: "Due date is required" });
      dueDate = data.dueDate;
      paymentTermDays = diffDays(data.issueDate, dueDate);
    } else {
      paymentTermDays = Number(data.paymentTerm);
      if (!Number.isInteger(paymentTermDays) || paymentTermDays < 0 || paymentTermDays > 365) throw new ActionError("Invalid payment term.", { paymentTerm: "Choose a payment term" });
      dueDate = addDays(data.issueDate, paymentTermDays);
    }
    if (dueDate < data.issueDate) throw new ActionError("The due date cannot be before the issue date.", { dueDate: "Must be on or after the issue date" });

    const totals = computeTotals(data.items, data.discount ?? 0);
    if ((data.discount ?? 0) > totals.subtotal) throw new ActionError("The discount cannot exceed the subtotal.", { discount: "Cannot exceed the subtotal" });

    const fields = {
      client: data.client,
      project: data.project ?? null,
      contract: data.contract ?? null,
      milestone: data.milestone ?? null,
      issueDate: data.issueDate,
      dueDate,
      paymentTermDays,
      items: totals.items.map((i) => ({ description: i.description, quantity: i.quantity, rate: i.rate, taxRate: i.taxRate, amount: i.amount })),
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      balance: totals.total,
      placeOfSupply: data.placeOfSupply ?? "",
      notes: data.notes ?? "",
      terms: data.terms ?? "",
    };

    if (data.id) {
      const before = await loadInvoice(data.id);
      if (before.status !== "draft") throw new ActionError("Only draft invoices can be edited.");
      const updated = await Invoice.findOneAndUpdate(
        { _id: data.id, status: "draft" },
        { $set: fields, $push: { history: { action: "edited", by: user._id, byName: user.name, at: new Date() } } },
        { returnDocument: "after" },
      ).lean();
      if (!updated) throw new ActionError("This invoice is no longer a draft.");
      await audit(user, {
        action: "update",
        entity: "invoice",
        entityId: updated._id,
        ref: updated.draftNo,
        summary: `Updated draft ${updated.draftNo}`,
        // Amounts are intentionally left out of the audit trail (`audit.view` does not imply `invoices.view`).
        changes: diff({ ...before, client: before.client.toString() } as Record<string, unknown>, { ...updated, client: updated.client.toString() } as Record<string, unknown>, ["client", "issueDate", "dueDate", "subtotal", "discount", "taxTotal", "total"], ["subtotal", "discount", "taxTotal", "total"]),
      });
      return { id: updated._id.toString() };
    }

    const draftNo = await nextNumber("invoice-draft", ID_PREFIX.invoiceDraft, 5);
    const doc = await Invoice.create({
      ...fields,
      project: data.project,
      contract: data.contract,
      milestone: data.milestone,
      draftNo,
      status: "draft",
      createdBy: user._id,
      history: [{ action: "created", by: user._id, byName: user.name, at: new Date() }],
    });
    await audit(user, { action: "create", entity: "invoice", entityId: doc._id, ref: draftNo, summary: `Created draft invoice ${draftNo} for ${client.name}` });
    return { id: doc._id.toString() };
  }, "Draft saved");
}

/** Discards a draft invoice that was never issued. */
export async function deleteDraftInvoice(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("invoices.manage");
    const inv = await loadInvoice(id);
    const res = await Invoice.deleteOne({ _id: id, status: "draft" });
    if (res.deletedCount === 0) throw new ActionError("Only draft invoices can be deleted.");
    await audit(user, { action: "delete", entity: "invoice", entityId: inv._id, ref: inv.draftNo, summary: `Deleted draft invoice ${inv.draftNo}` });
    return null;
  }, "Draft deleted");
}

/** Issues a draft: assigns the final number, snapshots the billing details and marks the milestone invoiced. */
export async function issueInvoice(id: string): Promise<ActionResult<{ invoiceNo: string }>> {
  return runAction(async () => {
    const user = await actionPermission("invoices.manage");
    const inv = await loadInvoice(id);
    if (inv.status !== "draft") throw new ActionError("This invoice has already been issued.");
    if (inv.items.length === 0 || inv.total <= 0) throw new ActionError("Add line items with a total above zero before issuing.");

    const client = await Client.findById(inv.client, { name: 1, address: 1, gstin: 1, email: 1 }).lean();
    if (!client) throw new ActionError("The client of this invoice no longer exists.");

    if (inv.project && inv.milestone) {
      const project = await Project.findById(inv.project, { milestones: 1 }).lean();
      const m = project?.milestones.find((x) => x._id.toString() === inv.milestone?.toString());
      if (m?.invoiced && m.invoice?.toString() !== inv._id.toString()) throw new ActionError("The milestone on this invoice has already been invoiced.");
    }

    // Claim the draft first so a double click cannot consume two invoice numbers. Everything below is built from the
    // claimed document, so an edit that slipped in between loading and claiming cannot leave mismatched figures.
    const claimed = await Invoice.findOneAndUpdate({ _id: id, status: "draft" }, { $set: { status: "issued", issuedAt: new Date() } }, { returnDocument: "after" }).lean();
    if (!claimed) throw new ActionError("This invoice has already been issued.");

    let invoiceNo: string;
    let billedTo = client;
    try {
      if (claimed.client.toString() !== inv.client.toString()) {
        const latest = await Client.findById(claimed.client, { name: 1, address: 1, gstin: 1, email: 1 }).lean();
        if (!latest) throw new ActionError("The client of this invoice no longer exists.");
        billedTo = latest;
      }
      if (claimed.items.length === 0 || claimed.total <= 0) throw new ActionError("Add line items with a total above zero before issuing.");
      const settings = await getSettings();
      const n = settings.numbering;
      const fy = fiscalYear(zonedDateTime(claimed.issueDate, "12:00"));
      const seq = await nextSeq(n.invoiceIncludeFiscalYear ? `invoice:${fy}` : "invoice");
      invoiceNo = `${n.invoicePrefix}${n.invoiceIncludeFiscalYear ? `${fy}-` : ""}${String(seq).padStart(n.invoicePadding, "0")}`;
      await Invoice.updateOne(
        { _id: id },
        {
          $set: {
            invoiceNo,
            balance: balanceOf({ total: claimed.total, amountPaid: 0, amountRefunded: 0, adjustments: 0 }),
            billingSnapshot: { name: billedTo.name, address: formatAddress(billedTo.address), gstin: billedTo.gstin, email: billedTo.email },
          },
          $push: { history: { action: "issued", by: user._id, byName: user.name, at: new Date(), note: invoiceNo } },
        },
      );
    } catch (error) {
      await Invoice.updateOne({ _id: id, status: "issued", invoiceNo: { $exists: false } }, { $set: { status: "draft" }, $unset: { issuedAt: 1 } });
      throw error;
    }

    if (claimed.project && claimed.milestone) {
      await Project.updateOne({ _id: claimed.project, "milestones._id": claimed.milestone }, { $set: { "milestones.$.invoiced": true, "milestones.$.invoice": claimed._id } });
    }
    await audit(user, { action: "status", entity: "invoice", entityId: inv._id, ref: invoiceNo, summary: `Issued invoice ${invoiceNo} to ${billedTo.name}`, changes: [{ field: "status", from: "draft", to: "issued" }] });
    return { invoiceNo };
  }, "Invoice issued");
}

/** Cancels an issued invoice. Refund any payment first — an invoice with money still received cannot be cancelled. */
export async function cancelInvoice(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("invoices.manage");
    const text = parse(zs.text("Reason", 500), reason);
    const inv = await loadInvoice(id);
    if (inv.status === "draft") throw new ActionError("Delete the draft instead of cancelling it.");
    if (inv.status === "cancelled") throw new ActionError("This invoice is already cancelled.");
    if (round2(inv.amountPaid - inv.amountRefunded) > 0) throw new ActionError("Payments are still recorded against this invoice. Refund them before cancelling.");

    const res = await Invoice.findOneAndUpdate(
      { _id: id, status: inv.status, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded },
      {
        $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: text, balance: 0 },
        $push: { history: { action: "cancelled", by: user._id, byName: user.name, at: new Date(), note: text } },
      },
      { returnDocument: "after" },
    ).lean();
    if (!res) throw new ActionError("This invoice was just updated by someone else. Refresh and try again.");

    if (inv.project && inv.milestone) {
      await Project.updateOne(
        { _id: inv.project, milestones: { $elemMatch: { _id: inv.milestone, invoice: inv._id } } },
        { $set: { "milestones.$.invoiced": false }, $unset: { "milestones.$.invoice": 1 } },
      );
    }
    await audit(user, { action: "cancel", entity: "invoice", entityId: inv._id, ref: label(inv), summary: `Cancelled invoice ${label(inv)}: ${text}`, changes: [{ field: "status", from: inv.status, to: "cancelled" }] });
    return null;
  }, "Invoice cancelled");
}

type MoneyEvent = { type: "payment" | "refund" | "adjustment"; date: string; amount: number; method: string; reference?: string; note?: string };

/**
 * Applies one money movement atomically: the invoice totals only change when nobody else changed them in the
 * meantime, then the Payment row is written (the invoice change is reverted if that write fails).
 */
async function applyMoneyEvent(
  inv: IInvoice,
  event: MoneyEvent,
  user: { _id: IInvoice["_id"]; name: string },
): Promise<{ paymentNo: string; balance: number; status: string }> {
  const next = {
    total: inv.total,
    amountPaid: round2(inv.amountPaid + (event.type === "payment" ? event.amount : 0)),
    amountRefunded: round2(inv.amountRefunded + (event.type === "refund" ? event.amount : 0)),
    adjustments: round2(inv.adjustments + (event.type === "adjustment" ? event.amount : 0)),
  };
  const balance = balanceOf(next);
  const status = settledStatus(next);
  // Take the number before touching the invoice so a counter failure cannot leave totals without a Payment row.
  const paymentNo = await nextNumber("payment", ID_PREFIX.payment, 5);
  const updated = await Invoice.findOneAndUpdate(
    { _id: inv._id, status: inv.status, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded, adjustments: inv.adjustments },
    { $set: { amountPaid: next.amountPaid, amountRefunded: next.amountRefunded, adjustments: next.adjustments, balance, status } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw new ActionError("This invoice was just updated by someone else. Refresh and try again.");

  try {
    await Payment.create({
      paymentNo,
      invoice: inv._id,
      client: inv.client,
      project: inv.project,
      type: event.type,
      date: event.date,
      amount: event.amount,
      method: event.method,
      reference: event.reference,
      note: event.note,
      recordedBy: user._id,
      recordedByName: user.name,
    });
  } catch (error) {
    await Invoice.updateOne(
      { _id: inv._id },
      { $set: { amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded, adjustments: inv.adjustments, balance: inv.balance, status: inv.status } },
    );
    throw error;
  }
  return { paymentNo, balance, status };
}

function assertDateNotFuture(date: string, field = "date") {
  if (date > todayKey()) throw new ActionError("The date cannot be in the future.", { [field]: "Cannot be in the future" });
}

export async function recordPayment(id: string, input: Record<string, unknown>): Promise<ActionResult<{ paymentNo: string }>> {
  return runAction(async () => {
    const user = await actionPermission("invoices.payments");
    const data = parse(paymentSchema, input);
    const inv = await loadInvoice(id);
    if (!["issued", "partially_paid", "overdue"].includes(inv.status)) throw new ActionError("Payments can only be recorded against issued invoices with a balance due.");
    assertDateNotFuture(data.date);
    const amount = round2(data.amount);
    if (amount > inv.balance + 0.004) throw new ActionError(`The amount exceeds the balance due (${inr(inv.balance, true)}).`, { amount: `Maximum ${inr(inv.balance, true)}` });

    const res = await applyMoneyEvent(inv, { type: "payment", date: data.date, amount, method: data.method, reference: data.reference, note: data.note }, user);
    await audit(user, { action: "payment", entity: "payment", entityId: inv._id, ref: label(inv), summary: `Recorded payment ${res.paymentNo} (${data.method}) on ${label(inv)}` });
    const recipients = await usersWithPermission("invoices.manage");
    await notify(
      recipients,
      { type: "invoice", title: `Payment received: ${inr(amount, true)}`, body: `${label(inv)} · ${data.method}${data.reference ? ` · ${data.reference}` : ""}. Balance ${inr(res.balance, true)}.`, link: `/invoices/${inv._id}` },
      [user._id],
    );
    return { paymentNo: res.paymentNo };
  }, "Payment recorded");
}

export async function recordRefund(id: string, input: Record<string, unknown>): Promise<ActionResult<{ paymentNo: string }>> {
  return runAction(async () => {
    const user = await actionPermission("invoices.payments");
    const data = parse(refundSchema, input);
    const inv = await loadInvoice(id);
    if (inv.status === "draft" || inv.status === "cancelled") throw new ActionError("Refunds can only be recorded against issued invoices.");
    assertDateNotFuture(data.date);
    const amount = round2(data.amount);
    const net = round2(inv.amountPaid - inv.amountRefunded);
    if (net <= 0) throw new ActionError("There is no payment left to refund on this invoice.");
    if (amount > net + 0.004) throw new ActionError(`A refund cannot exceed the net amount paid (${inr(net, true)}).`, { amount: `Maximum ${inr(net, true)}` });

    const res = await applyMoneyEvent(inv, { type: "refund", date: data.date, amount, method: data.method, reference: data.reference, note: data.note }, user);
    await audit(user, { action: "payment", entity: "payment", entityId: inv._id, ref: label(inv), summary: `Refunded on ${label(inv)} (${res.paymentNo}): ${data.note}` });
    await notifyPermission("invoices.manage", { type: "invoice", title: `Refund recorded: ${inr(amount, true)}`, body: `${label(inv)} · ${data.note}`, link: `/invoices/${inv._id}` }, [user._id]);
    return { paymentNo: res.paymentNo };
  }, "Refund recorded");
}

/** Write-off / adjustment: reduces the balance without a payment. A note is mandatory. */
export async function recordAdjustment(id: string, input: Record<string, unknown>): Promise<ActionResult<{ paymentNo: string }>> {
  return runAction(async () => {
    const user = await actionPermission("invoices.payments");
    const data = parse(adjustmentSchema, input);
    const inv = await loadInvoice(id);
    if (!["issued", "partially_paid", "overdue"].includes(inv.status)) throw new ActionError("Adjustments can only be recorded against issued invoices with a balance due.");
    assertDateNotFuture(data.date);
    const amount = round2(data.amount);
    if (amount > inv.balance + 0.004) throw new ActionError(`The adjustment exceeds the balance due (${inr(inv.balance, true)}).`, { amount: `Maximum ${inr(inv.balance, true)}` });

    const res = await applyMoneyEvent(inv, { type: "adjustment", date: data.date, amount, method: "Adjustment", note: data.note }, user);
    await audit(user, { action: "payment", entity: "payment", entityId: inv._id, ref: label(inv), summary: `Adjusted ${label(inv)} (${res.paymentNo}): ${data.note}` });
    await notifyPermission("invoices.manage", { type: "invoice", title: `Invoice adjusted: ${inr(amount, true)}`, body: `${label(inv)} · ${data.note}`, link: `/invoices/${inv._id}` }, [user._id]);
    return { paymentNo: res.paymentNo };
  }, "Adjustment recorded");
}
