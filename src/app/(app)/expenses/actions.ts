"use server";

import { z } from "zod";
import { runAction, actionPermission, actionUser, ActionError, parse, type ActionResult } from "@/lib/actions";
import { can, type CurrentUser } from "@/lib/auth/session";
import { zs, isObjectId } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notify, notifyPermission } from "@/lib/notify";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { getSettings } from "@/lib/settings";
import { resolveFileRefs } from "@/lib/files";
import { namesFor } from "@/lib/people";
import { inr, round2 } from "@/lib/format";
import { todayKey } from "@/lib/time";
import { Client, Department, Expense, PayrollRun, Payslip, Project, type FileRef, type IExpense } from "@/lib/models";
import { EXPENSE_PAY_METHODS } from "./constants";

const expenseSchema = z.object({
  id: zs.optId(),
  intent: z.enum(["draft", "submit"]),
  date: zs.date("Date"),
  category: zs.text("Category", 80),
  amount: zs.num("Amount", { min: 0.01 }),
  taxAmount: zs.optNum({ min: 0 }),
  vendor: zs.optText(150),
  description: zs.text("Description", 2000),
  project: zs.optId(),
  client: zs.optId(),
  department: zs.optId(),
  type: z.enum(["reimbursable", "company"], { error: "Choose reimbursable or company paid" }),
  paymentMode: zs.optText(60),
  receipts: zs.ids(),
});

const paySchema = z.object({
  date: zs.date("Payment date"),
  method: z.enum(EXPENSE_PAY_METHODS, { error: "Choose a payment method" }),
  reference: zs.optText(120),
});

async function loadExpense(id: string): Promise<IExpense> {
  if (!isObjectId(id)) throw new ActionError("Expense not found.");
  const e = await Expense.findById(id).lean();
  if (!e) throw new ActionError("Expense not found.");
  return e;
}

const isOwner = (e: Pick<IExpense, "user">, user: Pick<CurrentUser, "id">) => e.user.toString() === user.id;
const historyEntry = (user: Pick<CurrentUser, "_id" | "name">, action: string, note?: string) => ({ action, by: user._id, byName: user.name, at: new Date(), note });

/** Notifies everyone who can approve expenses (never the submitter). */
async function notifyApprovers(expense: Pick<IExpense, "_id" | "expenseNo" | "category" | "amount">, submitter: CurrentUser, title: string): Promise<void> {
  await notifyPermission(
    "expenses.approve",
    { type: "expense", title, body: `${submitter.name} · ${inr(expense.amount, true)} · ${expense.category}`, link: `/expenses/${expense._id}`, actionable: true },
    [submitter._id],
  );
}

/** Creates or updates an expense (own drafts and rejected items only); optionally submits it for approval. */
export async function saveExpense(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const data = parse(expenseSchema, input);
    const settings = await getSettings();

    const existing = data.id ? await loadExpense(data.id) : null;
    if (existing) {
      if (!isOwner(existing, user)) throw new ActionError("You can only edit your own expenses.");
      if (existing.status !== "draft" && existing.status !== "rejected") throw new ActionError("Only drafts and rejected expenses can be edited.");
    } else if (user.personType === "admin") {
      throw new ActionError("The super admin account does not file expenses.");
    }

    if (data.date > todayKey()) throw new ActionError("The expense date cannot be in the future.", { date: "Cannot be in the future" });
    if (!settings.expenseCategories.includes(data.category) && existing?.category !== data.category) throw new ActionError("Choose a category from the list.", { category: "Choose a category" });
    const amount = round2(data.amount);
    const taxAmount = round2(data.taxAmount ?? 0);
    if (taxAmount > amount) throw new ActionError("The tax amount cannot exceed the total amount.", { taxAmount: "Cannot exceed the amount" });

    if (data.project) {
      const p = await Project.findById(data.project, { manager: 1, team: 1 }).lean();
      if (!p) throw new ActionError("Project not found.", { project: "Choose a project" });
      const onProject = p.manager?.toString() === user.id || p.team.some((m) => m.user.toString() === user.id);
      if (!onProject && !can(user, "projects.view_all")) throw new ActionError("You can only charge expenses to projects you work on.", { project: "Not one of your projects" });
    }
    if (data.client) {
      if (!can(user, "crm.view")) throw new ActionError("You don't have access to client records.", { client: "Not allowed" });
      if (!(await Client.exists({ _id: data.client }))) throw new ActionError("Client not found.", { client: "Choose a client" });
    }
    if (data.department && !(await Department.exists({ _id: data.department }))) throw new ActionError("Department not found.", { department: "Choose a department" });

    // Keep references of receipts that are already attached; resolve the newly uploaded ones.
    const kept = new Map((existing?.receipts ?? []).map((r) => [r.file.toString(), r]));
    const fresh = await resolveFileRefs(user, data.receipts.filter((r) => !kept.has(r)));
    const keptRefs = data.receipts.flatMap((r) => {
      const ref = kept.get(r);
      return ref ? [ref] : [];
    });
    const receipts: FileRef[] = [...keptRefs, ...fresh];
    const submit = data.intent === "submit";

    const fields = {
      date: data.date,
      category: data.category,
      amount,
      taxAmount,
      vendor: data.vendor ?? "",
      description: data.description,
      type: data.type,
      paymentMode: data.paymentMode ?? "",
      receipts,
      project: data.project ?? null,
      client: data.client ?? null,
      department: data.department ?? null,
    };
    const decisionReset = { approver: null, approverName: null, decidedAt: null, decisionNote: null };

    if (existing) {
      const updated = await Expense.findOneAndUpdate(
        { _id: existing._id, user: user._id, status: { $in: ["draft", "rejected"] } },
        {
          $set: { ...fields, status: submit ? "submitted" : "draft", ...(submit ? { submittedAt: new Date(), ...decisionReset } : {}) },
          $push: { history: historyEntry(user, submit ? "submitted" : "edited") },
        },
        { returnDocument: "after" },
      ).lean();
      if (!updated) throw new ActionError("This expense can no longer be edited.");
      await audit(user, { action: submit ? "submit" : "update", entity: "expense", entityId: updated._id, ref: updated.expenseNo, summary: `${submit ? "Submitted" : "Updated"} expense ${updated.expenseNo} (${inr(amount, true)})` });
      if (submit) await notifyApprovers(updated, user, `Expense ${updated.expenseNo} awaiting approval`);
      return { id: updated._id.toString() };
    }

    const expenseNo = await nextNumber("expense", ID_PREFIX.expense, 5);
    const doc = await Expense.create({
      ...fields,
      project: data.project,
      client: data.client,
      department: data.department,
      expenseNo,
      user: user._id,
      status: submit ? "submitted" : "draft",
      submittedAt: submit ? new Date() : undefined,
      history: [historyEntry(user, "created"), ...(submit ? [historyEntry(user, "submitted")] : [])],
    });
    await audit(user, { action: submit ? "submit" : "create", entity: "expense", entityId: doc._id, ref: expenseNo, summary: `${submit ? "Submitted" : "Saved draft of"} expense ${expenseNo} (${inr(amount, true)}, ${data.category})` });
    if (submit) await notifyApprovers(doc, user, `Expense ${expenseNo} awaiting approval`);
    return { id: doc._id.toString() };
  }, "Expense saved");
}

/** Submits an existing draft or rejected expense of the signed-in person for approval. */
export async function submitExpense(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const e = await loadExpense(id);
    if (!isOwner(e, user)) throw new ActionError("You can only submit your own expenses.");
    const updated = await Expense.findOneAndUpdate(
      { _id: e._id, user: user._id, status: { $in: ["draft", "rejected"] } },
      { $set: { status: "submitted", submittedAt: new Date(), approver: null, approverName: null, decidedAt: null, decisionNote: null }, $push: { history: historyEntry(user, "submitted") } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new ActionError("This expense has already been submitted.");
    await audit(user, { action: "submit", entity: "expense", entityId: e._id, ref: e.expenseNo, summary: `Submitted expense ${e.expenseNo} (${inr(e.amount, true)})`, changes: [{ field: "status", from: e.status, to: "submitted" }] });
    await notifyApprovers(updated, user, `Expense ${e.expenseNo} awaiting approval`);
    return null;
  }, "Submitted for approval");
}

export async function deleteExpense(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const e = await loadExpense(id);
    if (!isOwner(e, user)) throw new ActionError("You can only delete your own expenses.");
    const res = await Expense.deleteOne({ _id: e._id, user: user._id, status: { $in: ["draft", "rejected"] } });
    if (res.deletedCount === 0) throw new ActionError("Only drafts and rejected expenses can be deleted.");
    await audit(user, { action: "delete", entity: "expense", entityId: e._id, ref: e.expenseNo, summary: `Deleted expense ${e.expenseNo}` });
    return null;
  }, "Expense deleted");
}

async function decide(id: string, decision: "approved" | "rejected", note: string | undefined): Promise<void> {
  const user = await actionPermission("expenses.approve");
  const e = await loadExpense(id);
  if (isOwner(e, user)) throw new ActionError("You cannot approve or reject your own expense.");
  const updated = await Expense.findOneAndUpdate(
    { _id: e._id, status: "submitted" },
    {
      $set: { status: decision, approver: user._id, approverName: user.name, decidedAt: new Date(), decisionNote: note ?? "" },
      $push: { history: historyEntry(user, decision, note) },
    },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw new ActionError("This expense is no longer waiting for approval.");
  const submitterName = (await namesFor([e.user])).get(e.user.toString()) ?? "staff";
  await audit(user, {
    action: decision === "approved" ? "approve" : "reject",
    entity: "expense",
    entityId: e._id,
    ref: e.expenseNo,
    summary: `${decision === "approved" ? "Approved" : "Rejected"} expense ${e.expenseNo} (${inr(e.amount, true)}) of ${submitterName}${note ? `: ${note}` : ""}`,
    changes: [{ field: "status", from: "submitted", to: decision }],
  });
  await notify([e.user], {
    type: "expense",
    title: `Expense ${e.expenseNo} ${decision}`,
    body: `${inr(e.amount, true)} · ${e.category}${note ? ` · ${note}` : ""}`,
    link: `/expenses/${e._id}`,
    priority: decision === "rejected" ? "high" : "normal",
  });
}

export async function approveExpense(id: string, note?: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await decide(id, "approved", parse(zs.optText(500), note));
    return null;
  }, "Expense approved");
}

export async function rejectExpense(id: string, note: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const reason = parse(zs.text("Reason", 500), note);
    await decide(id, "rejected", reason);
    return null;
  }, "Expense rejected");
}

/** Records the reimbursement (or the company payment) of an approved expense. */
export async function payExpense(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("expenses.pay");
    const data = parse(paySchema, input);
    const e = await loadExpense(id);
    if (e.status !== "approved") throw new ActionError("Only approved expenses can be paid.");
    if (isOwner(e, user)) throw new ActionError("You can't record the payment of your own claim. Ask another finance user.");
    if (data.date > todayKey()) throw new ActionError("The payment date cannot be in the future.", { date: "Cannot be in the future" });

    // Reimbursements that are part of an unfinished payroll run are paid with that run.
    const slips = await Payslip.find({ reimbursedExpenses: e._id }, { run: 1 }).lean();
    if (slips.length > 0) {
      const run = await PayrollRun.findOne({ _id: { $in: slips.map((s) => s.run) }, status: { $in: ["draft", "verified", "approved"] } }, { runNo: 1 }).lean();
      if (run) throw new ActionError(`This claim is included in payroll run ${run.runNo} and will be reimbursed with it.`);
    }

    const updated = await Expense.findOneAndUpdate(
      { _id: e._id, status: "approved" },
      {
        $set: { status: "paid", payment: { date: data.date, method: data.method, reference: data.reference, viaPayroll: false, by: user._id, byName: user.name } },
        $push: { history: historyEntry(user, "paid", `${data.method}${data.reference ? ` · ${data.reference}` : ""}`) },
      },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new ActionError("This expense has already been paid.");
    await audit(user, { action: "payment", entity: "expense", entityId: e._id, ref: e.expenseNo, summary: `Recorded ${e.type === "reimbursable" ? "reimbursement" : "payment"} of ${inr(e.amount, true)} for ${e.expenseNo} (${data.method})`, changes: [{ field: "status", from: "approved", to: "paid" }] });
    await notify([e.user], {
      type: "expense",
      title: e.type === "reimbursable" ? `Expense ${e.expenseNo} reimbursed` : `Expense ${e.expenseNo} paid`,
      body: `${inr(e.amount, true)} · ${data.method}${data.reference ? ` · ${data.reference}` : ""}`,
      link: `/expenses/${e._id}`,
    });
    return null;
  }, "Payment recorded");
}
