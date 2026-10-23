"use server";

import { z } from "zod";
import { runAction, actionPermission, ActionError, parse, type ActionResult } from "@/lib/actions";
import type { CurrentUser } from "@/lib/auth/session";
import { zs, isObjectId } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notify, notifyPermission } from "@/lib/notify";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { inr, round2 } from "@/lib/format";
import { monthKey, todayKey } from "@/lib/time";
import { Expense, PayrollRun, Payslip, SalaryAdvance, User, type IPayrollRun, type IPayslip, type PayLine } from "@/lib/models";
import { buildPayslips, payslipDoc, payslipFields, refreshRunTotals } from "@/lib/payroll/load";
import { isPeriod, type ManualLines } from "@/lib/payroll/calc";
import { KIND_LABEL, PAYROLL_PAYMENT_METHODS, periodLabel } from "@/lib/payroll/constants";
import { EXITED_STATUSES } from "@/lib/people";

const runSchema = z.object({
  period: zs.month("Period"),
  kind: z.enum(["salary", "stipend"], { error: "Choose salary or stipend" }),
});

const lineSchema = z.object({
  name: zs.text("Name", 80),
  amount: zs.num("Amount", { min: 0, max: 100_000_000 }),
});

const linesSchema = z.object({
  earnings: z.array(lineSchema).max(20, "Too many earning lines"),
  deductions: z.array(lineSchema).max(20, "Too many deduction lines"),
  remarks: zs.optText(500),
});

const paymentSchema = z.object({
  date: zs.date("Payment date"),
  method: z.enum(PAYROLL_PAYMENT_METHODS, { error: "Choose a payment method" }),
  reference: zs.optText(120),
});

const advanceSchema = z.object({
  user: zs.id("Person"),
  amount: zs.num("Amount", { min: 1, max: 100_000_000 }),
  date: zs.date("Date"),
  reason: zs.optText(500),
  monthlyRecovery: zs.num("Monthly recovery", { min: 1 }),
});

const entry = (user: Pick<CurrentUser, "_id" | "name">, action: string, note?: string) => ({ action, by: user._id, byName: user.name, at: new Date(), note });
const runTitle = (run: Pick<IPayrollRun, "kind" | "period" | "runNo">) => `${KIND_LABEL[run.kind]} run ${run.runNo} · ${periodLabel(run.period)}`;

async function loadRun(id: string): Promise<IPayrollRun> {
  if (!isObjectId(id)) throw new ActionError("Payroll run not found.");
  const run = await PayrollRun.findById(id).lean();
  if (!run) throw new ActionError("Payroll run not found.");
  return run;
}

const manualOf = (lines: PayLine[]) => lines.filter((l) => l.source === "manual");
const linesText = (earnings: PayLine[], deductions: PayLine[]) =>
  [earnings.length ? `Earnings: ${earnings.map((l) => `${l.name} ${inr(l.amount, true)}`).join(", ")}` : "", deductions.length ? `Deductions: ${deductions.map((l) => `${l.name} ${inr(l.amount, true)}`).join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ") || "No manual lines";
const isEditor = (run: Pick<IPayrollRun, "editors">, user: CurrentUser) => (run.editors ?? []).some((e) => e.toString() === user.id);

/** Guards the writes of a long calculation against the run having been verified or cancelled in the meantime. */
async function assertStillDraft(runId: IPayrollRun["_id"]): Promise<void> {
  if (!(await PayrollRun.exists({ _id: runId, status: "draft" }))) throw new ActionError("This run was changed by someone else while it was being calculated. Reload and try again.");
}

/**
 * Every reimbursed expense in a run must still be approved and unpaid. A claim that was paid directly after the run
 * picked it up would otherwise be paid twice (once directly, once inside net pay).
 */
async function assertReimbursementsStillDue(runId: IPayrollRun["_id"]): Promise<void> {
  const slips = (await Payslip.find({ run: runId }, { reimbursedExpenses: 1, snapshot: 1 }).lean()).filter((p) => p.reimbursedExpenses.length > 0);
  const ids = slips.flatMap((p) => p.reimbursedExpenses);
  if (ids.length === 0) return;
  const stillDue = new Set((await Expense.find({ _id: { $in: ids }, status: "approved" }, { _id: 1 }).lean()).map((e) => e._id.toString()));
  const stale = slips.filter((p) => p.reimbursedExpenses.some((e) => !stillDue.has(e.toString())));
  if (stale.length > 0) {
    throw new ActionError(`Some reimbursements in this run were already paid or changed (${stale.slice(0, 3).map((p) => p.snapshot.name).join(", ")}). Send the run back to draft and recalculate it.`);
  }
}

/** Heals the (rare) case where a run was approved but its payslips were not all flipped to approved. */
async function ensurePayslipsApproved(run: IPayrollRun): Promise<void> {
  if (run.status === "approved") await Payslip.updateMany({ run: run._id, status: "draft" }, { $set: { status: "approved" } });
}

/** Creates a payroll or stipend run for a month and generates its payslips. */
export async function createPayrollRun(input: Record<string, unknown>): Promise<ActionResult<{ id: string; skipped: string[] }>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare");
    const data = parse(runSchema, input);
    if (!isPeriod(data.period)) throw new ActionError("Choose a valid month.", { period: "Choose a valid month" });
    if (data.period > monthKey()) throw new ActionError("Payroll cannot be prepared for a future month.", { period: "Cannot be in the future" });

    const clash = await PayrollRun.findOne({ period: data.period, kind: data.kind, status: { $ne: "cancelled" } }, { runNo: 1 }).lean();
    if (clash) throw new ActionError(`A ${KIND_LABEL[data.kind].toLowerCase()} run for ${periodLabel(data.period)} already exists (${clash.runNo}). Cancel it first to start again.`, { period: "A run already exists for this month" });

    const build = await buildPayslips({ period: data.period, kind: data.kind });
    const skipped = build.skipped.map((s) => `${s.name} (${s.reason})`);
    if (build.calcs.length === 0) {
      throw new ActionError(
        data.kind === "stipend"
          ? "No interns or trainees with an eligible stipend are active in this month."
          : `No employees to pay for this month.${skipped.length ? ` Skipped: ${skipped.slice(0, 3).join(", ")}.` : ""}`,
      );
    }

    const runNo = await nextNumber("payroll", ID_PREFIX.payroll, 4);
    const run = await PayrollRun.create({
      runNo,
      period: data.period,
      kind: data.kind,
      activeKey: `${data.period}:${data.kind}`,
      status: "draft",
      workingDays: build.workingDays,
      preparedBy: user._id,
      preparedByName: user.name,
      history: [entry(user, "created")],
    }).catch((error: unknown) => {
      // The unique activeKey stops two people creating the same run at the same moment.
      if ((error as { code?: number }).code === 11000) throw new ActionError(`A ${KIND_LABEL[data.kind].toLowerCase()} run for ${periodLabel(data.period)} already exists.`, { period: "A run already exists for this month" });
      throw error;
    });
    try {
      await Payslip.insertMany(build.calcs.map((c) => ({ ...payslipDoc(c, { id: run._id.toString(), period: data.period, kind: data.kind }), status: "draft" })));
      await refreshRunTotals(run._id, build.workingDays);
    } catch (error) {
      await Payslip.deleteMany({ run: run._id });
      await PayrollRun.deleteOne({ _id: run._id });
      throw error;
    }
    await audit(user, { action: "create", entity: "payroll_run", entityId: run._id, ref: runNo, summary: `Created ${KIND_LABEL[data.kind].toLowerCase()} run ${runNo} for ${periodLabel(data.period)} with ${build.calcs.length} payslips` });
    return { id: run._id.toString(), skipped };
  }, "Run created");
}

/** Recalculates every payslip of a draft run; manual lines and remarks are kept. */
export async function recalculateRun(id: string): Promise<ActionResult<{ added: number; removed: number }>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare");
    const run = await loadRun(id);
    if (run.status !== "draft") throw new ActionError("Only draft runs can be recalculated.");

    const existing = await Payslip.find({ run: run._id }, { user: 1, earnings: 1, deductions: 1 }).lean();
    const manual = new Map<string, ManualLines>(existing.map((p) => [p.user.toString(), { earnings: manualOf(p.earnings), deductions: manualOf(p.deductions) }]));
    const build = await buildPayslips({ period: run.period, kind: run.kind, runId: id, manual });
    await assertStillDraft(run._id);

    const known = new Set(existing.map((p) => p.user.toString()));
    const keep = new Set(build.calcs.map((c) => c.userId));
    const ref = { id, period: run.period, kind: run.kind };
    let added = 0;
    for (const calc of build.calcs) {
      if (known.has(calc.userId)) {
        await Payslip.updateOne({ run: run._id, user: calc.userId, status: "draft" }, { $set: payslipFields(calc) });
      } else {
        await Payslip.create({ ...payslipDoc(calc, ref), status: "draft" });
        added += 1;
      }
    }
    const removedUsers = [...known].filter((u) => !keep.has(u));
    if (removedUsers.length) await Payslip.deleteMany({ run: run._id, user: { $in: removedUsers }, status: "draft" });
    await refreshRunTotals(run._id, build.workingDays);
    await PayrollRun.updateOne({ _id: run._id }, { $push: { history: entry(user, "recalculated") }, $addToSet: { editors: user._id } });
    await audit(user, { action: "update", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Recalculated ${runTitle(run)} (${build.calcs.length} payslips, ${added} added, ${removedUsers.length} removed)` });
    return { added, removed: removedUsers.length };
  }, "Run recalculated");
}

/** Replaces the manual lines (bonus, incentive, overtime, TDS, other) and remarks of a draft payslip. */
export async function savePayslipLines(payslipId: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare");
    const data = parse(linesSchema, input);
    if (!isObjectId(payslipId)) throw new ActionError("Payslip not found.");
    const slip = await Payslip.findById(payslipId).lean();
    if (!slip) throw new ActionError("Payslip not found.");
    const run = await loadRun(slip.run.toString());
    if (run.status !== "draft" || slip.status !== "draft") throw new ActionError("Approved and paid payslips are locked. Only draft runs can be edited.");
    if (!user.isSuperAdmin && slip.user.toString() === user.id) throw new ActionError("You can't edit your own payslip. Ask another payroll preparer.");

    const toLines = (lines: { name: string; amount: number }[], prefix: string): PayLine[] =>
      lines.filter((l) => l.amount > 0).map((l, i) => ({ key: `${prefix}:${i}`, name: l.name, amount: round2(l.amount), source: "manual" as const }));
    const manual = new Map<string, ManualLines>([[slip.user.toString(), { earnings: toLines(data.earnings, "manual-earning"), deductions: toLines(data.deductions, "manual-deduction") }]]);
    // Rebuild this one payslip so advance recovery still respects the new net pay.
    const build = await buildPayslips({ period: run.period, kind: run.kind, runId: run._id.toString(), manual, only: [slip.user.toString()] });
    const calc = build.calcs[0];
    if (!calc) throw new ActionError("This person is no longer eligible for the run. Recalculate the run to refresh it.");
    await assertStillDraft(run._id);
    // The amounts are kept on the payslip and the run (both only readable with `payroll.view`), never in the audit trail.
    const change = { ...entry(user, "lines_edited", data.remarks || undefined), from: linesText(manualOf(slip.earnings), manualOf(slip.deductions)), to: linesText(calc.earnings.filter((l) => l.source === "manual"), calc.deductions.filter((l) => l.source === "manual")) };
    await Payslip.updateOne({ _id: slip._id, status: "draft" }, { $set: { ...payslipFields(calc), remarks: data.remarks ?? "" }, $push: { history: change } });
    await PayrollRun.updateOne({ _id: run._id }, { $addToSet: { editors: user._id }, $push: { history: entry(user, "lines_edited", `${slip.snapshot.name}: ${change.to}`) } });
    await refreshRunTotals(run._id);
    await audit(user, { action: "update", entity: "payslip", entityId: slip._id, ref: slip.snapshot.name, summary: `Edited manual lines of ${slip.snapshot.name} in ${runTitle(run)}` });
    return null;
  }, "Payslip updated");
}

/** HR / Finance confirm attendance, leave and employment details are right; the run goes to management. */
export async function verifyRun(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare");
    const run = await loadRun(id);
    if (run.totals.count === 0) throw new ActionError("This run has no payslips.");
    await assertReimbursementsStillDue(run._id);
    const updated = await PayrollRun.findOneAndUpdate(
      { _id: run._id, status: "draft" },
      { $set: { status: "verified", verifiedBy: user._id, verifiedByName: user.name, verifiedAt: new Date() }, $push: { history: entry(user, "verified") } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new ActionError("This run is no longer a draft.");
    await audit(user, { action: "status", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Verified ${runTitle(run)}`, changes: [{ field: "status", from: "draft", to: "verified" }] });
    await notifyPermission(
      "payroll.approve",
      { type: "payroll", title: `${KIND_LABEL[run.kind]} run for ${periodLabel(run.period)} awaits approval`, body: `${run.runNo} · ${run.totals.count} payslips · net ${inr(run.totals.net)}`, link: `/payroll/${run._id}`, actionable: true, priority: "high" },
      [user._id],
    );
    return null;
  }, "Run verified and sent for approval");
}

/** Sends a verified run back to the preparer for changes. */
export async function returnRunToDraft(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare", "payroll.approve");
    const note = parse(zs.text("Reason", 500), reason);
    const run = await loadRun(id);
    const updated = await PayrollRun.findOneAndUpdate(
      { _id: run._id, status: "verified" },
      { $set: { status: "draft" }, $unset: { verifiedBy: 1, verifiedByName: 1, verifiedAt: 1 }, $push: { history: entry(user, "returned", note) } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new ActionError("Only verified runs can be sent back.");
    await audit(user, { action: "status", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Sent ${runTitle(run)} back to draft: ${note}`, changes: [{ field: "status", from: "verified", to: "draft" }] });
    await notify([run.preparedBy], { type: "payroll", title: `${KIND_LABEL[run.kind]} run for ${periodLabel(run.period)} was sent back`, body: note, link: `/payroll/${run._id}` }, [user._id]);
    return null;
  }, "Run sent back to draft");
}

export async function approveRun(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.approve");
    const run = await loadRun(id);
    // Separation of duties (FRS §10.3): the approver must be a different person from the preparer, verifier and anyone who edited payslips.
    if (!user.isSuperAdmin && ([run.preparedBy, run.verifiedBy].some((p) => p?.toString() === user.id) || isEditor(run, user))) {
      throw new ActionError("You prepared, verified or edited payslips in this run, so someone else must approve it.");
    }
    if (run.status === "verified") await assertReimbursementsStillDue(run._id);
    const updated = await PayrollRun.findOneAndUpdate(
      { _id: run._id, status: "verified" },
      { $set: { status: "approved", approvedBy: user._id, approvedByName: user.name, approvedAt: new Date() }, $push: { history: entry(user, "approved") } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new ActionError("Only verified runs can be approved.");
    await Payslip.updateMany({ run: run._id, status: "draft" }, { $set: { status: "approved" } });
    await audit(user, { action: "approve", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Approved ${runTitle(run)}`, changes: [{ field: "status", from: "verified", to: "approved" }] });
    await notifyPermission(
      "payroll.pay",
      { type: "payroll", title: `${KIND_LABEL[run.kind]} run for ${periodLabel(run.period)} approved — record payment`, body: `${run.runNo} · net ${inr(run.totals.net)}`, link: `/payroll/${run._id}`, actionable: true },
      [user._id],
    );
    return null;
  }, "Run approved");
}

export async function cancelRun(id: string, reason: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare", "payroll.approve");
    const note = parse(zs.text("Reason", 500), reason);
    const run = await loadRun(id);
    const updated = await PayrollRun.findOneAndUpdate(
      { _id: run._id, status: { $in: ["draft", "verified"] } },
      { $set: { status: "cancelled" }, $unset: { activeKey: 1 }, $push: { history: entry(user, "cancelled", note) } },
      { returnDocument: "after" },
    ).lean();
    if (!updated) throw new ActionError("Only draft or verified runs can be cancelled. Approved and paid runs are locked.");
    // The dialog promises the payslips are discarded; drafts of a cancelled run must not linger in reports.
    await Payslip.deleteMany({ run: run._id, status: "draft" });
    await audit(user, { action: "cancel", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Cancelled ${runTitle(run)}: ${note}`, changes: [{ field: "status", from: run.status, to: "cancelled" }] });
    return null;
  }, "Run cancelled");
}

/**
 * Marks one approved payslip as paid and applies its side effects exactly once: advance recoveries, the reimbursed
 * expenses and the "payslip is ready" notification.
 *
 * The side effects are idempotent (a recovery is recorded once per payslip, an expense is only flipped while it is
 * still approved) and run before the status flip, so a crash half-way can simply be retried, and two people clicking
 * at the same moment cannot apply them twice. The status flip is the claim that decides who sends the notification.
 */
async function settlePayslip(slip: IPayslip, pay: z.infer<typeof paymentSchema>, actor: CurrentUser): Promise<boolean> {
  if (slip.status !== "approved") return false;

  for (const r of slip.advanceRecoveries) {
    const applied = await SalaryAdvance.updateOne(
      {
        _id: r.advance,
        "recoveries.payslip": { $ne: slip._id },
        // Never recover more than the advance (a stale run could otherwise over-recover).
        $expr: { $lte: [{ $round: [{ $add: ["$recovered", r.amount] }, 2] }, { $add: ["$amount", 0.005] }] },
      },
      { $inc: { recovered: r.amount }, $push: { recoveries: { period: slip.period, amount: r.amount, payslip: slip._id } } },
    );
    if (applied.modifiedCount === 0) console.warn(`[payroll] advance recovery of payslip ${slip._id} was not applied (already recorded or beyond the advance)`);
    await SalaryAdvance.updateOne({ _id: r.advance, status: "open", $expr: { $gte: [{ $round: ["$recovered", 2] }, "$amount"] } }, { $set: { status: "closed" } });
  }
  if (slip.reimbursedExpenses.length > 0) {
    const flipped = await Expense.updateMany(
      { _id: { $in: slip.reimbursedExpenses }, status: "approved" },
      {
        $set: { status: "paid", payment: { date: pay.date, method: pay.method, reference: pay.reference, viaPayroll: true, by: actor._id, byName: actor.name } },
        $push: { history: entry(actor, "paid", `Reimbursed with ${periodLabel(slip.period)} payroll`) },
      },
    );
    if (flipped.modifiedCount < slip.reimbursedExpenses.length) {
      // Some claims were paid separately before this payslip was paid: leave a trace so Finance can reclaim the money.
      await audit(actor, { action: "payment", entity: "payslip", entityId: slip._id, ref: slip.snapshot.name, summary: `Check for a duplicate reimbursement: ${slip.reimbursedExpenses.length - flipped.modifiedCount} claim(s) on the ${periodLabel(slip.period)} payslip of ${slip.snapshot.name} had already been paid` });
    }
  }

  const claimed = await Payslip.findOneAndUpdate(
    { _id: slip._id, status: "approved" },
    { $set: { status: "paid", payment: { date: pay.date, method: pay.method, reference: pay.reference, by: actor._id, byName: actor.name, at: new Date() } } },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) return false;
  await notify([slip.user], {
    type: "payroll",
    title: `Your payslip for ${periodLabel(slip.period)} is ready`,
    body: `Net pay ${inr(slip.net, true)} paid on ${pay.date}.`,
    link: `/payslips/${slip._id}`,
  });
  return true;
}

/** Marks the run as paid once every payslip is paid. */
async function closeRunIfComplete(run: IPayrollRun, actor: CurrentUser): Promise<boolean> {
  const open = await Payslip.countDocuments({ run: run._id, status: { $ne: "paid" } });
  if (open > 0) return false;
  const res = await PayrollRun.updateOne({ _id: run._id, status: "approved" }, { $set: { status: "paid", paidAt: new Date() }, $push: { history: entry(actor, "paid") } });
  if (res.modifiedCount > 0) await audit(actor, { action: "payment", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `${runTitle(run)} fully paid`, changes: [{ field: "status", from: "approved", to: "paid" }] });
  return res.modifiedCount > 0;
}

function checkPayment(pay: z.infer<typeof paymentSchema>) {
  if (pay.date > todayKey()) throw new ActionError("The payment date cannot be in the future.", { date: "Cannot be in the future" });
}

/** Records payment of one payslip. */
export async function payPayslip(payslipId: string, input: Record<string, unknown>): Promise<ActionResult<{ runPaid: boolean }>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.pay");
    const pay = parse(paymentSchema, input);
    checkPayment(pay);
    if (!isObjectId(payslipId)) throw new ActionError("Payslip not found.");
    const slip = await Payslip.findById(payslipId).lean();
    if (!slip) throw new ActionError("Payslip not found.");
    const run = await loadRun(slip.run.toString());
    if (run.status !== "approved") throw new ActionError("Payments can only be recorded for approved runs.");
    if (!user.isSuperAdmin && isEditor(run, user)) throw new ActionError("You edited payslips in this run, so someone else must record its payment.");
    await ensurePayslipsApproved(run);
    const fresh = await Payslip.findById(slip._id).lean();
    if (!fresh || !(await settlePayslip(fresh, pay, user))) throw new ActionError("This payslip is not awaiting payment.");
    await audit(user, { action: "payment", entity: "payslip", entityId: slip._id, ref: slip.snapshot.name, summary: `Recorded payment to ${slip.snapshot.name} (${pay.method}) for ${periodLabel(slip.period)}` });
    return { runPaid: await closeRunIfComplete(run, user) };
  }, "Payment recorded");
}

/** Records payment of every approved payslip of the run with one date, method and reference. */
export async function payRun(id: string, input: Record<string, unknown>): Promise<ActionResult<{ paid: number; runPaid: boolean }>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.pay");
    const pay = parse(paymentSchema, input);
    checkPayment(pay);
    const run = await loadRun(id);
    if (run.status !== "approved") throw new ActionError("Payments can only be recorded for approved runs.");
    if (!user.isSuperAdmin && isEditor(run, user)) throw new ActionError("You edited payslips in this run, so someone else must record its payment.");
    await ensurePayslipsApproved(run);
    const slips = await Payslip.find({ run: run._id, status: "approved" }).lean();
    if (slips.length === 0) throw new ActionError("There are no payslips awaiting payment.");
    let paid = 0;
    for (const slip of slips) {
      if (await settlePayslip(slip, pay, user)) {
        paid += 1;
      }
    }
    await audit(user, { action: "payment", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Recorded payment of ${paid} payslips (${pay.method}) for ${runTitle(run)}` });
    return { paid, runPaid: await closeRunIfComplete(run, user) };
  }, "Payments recorded");
}

/** Records a salary advance that is recovered from later payslips. */
export async function createAdvance(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare", "payroll.pay");
    const data = parse(advanceSchema, input);
    if (!user.isSuperAdmin && data.user === user.id) throw new ActionError("You can't record an advance for yourself.", { user: "Choose someone else" });
    if (data.monthlyRecovery > data.amount) throw new ActionError("The monthly recovery cannot exceed the advance.", { monthlyRecovery: "Cannot exceed the advance" });
    if (data.date > todayKey()) throw new ActionError("The advance date cannot be in the future.", { date: "Cannot be in the future" });
    const person = await User.findOne({ _id: data.user, personType: { $in: ["employee", "trainee", "intern"] }, status: { $nin: EXITED_STATUSES } }, { name: 1 }).lean();
    if (!person) throw new ActionError("Choose a current employee, trainee or intern.", { user: "Choose a person" });

    const doc = await SalaryAdvance.create({
      user: person._id,
      amount: round2(data.amount),
      date: data.date,
      reason: data.reason,
      monthlyRecovery: round2(data.monthlyRecovery),
      recordedBy: user._id,
      recordedByName: user.name,
    });
    await audit(user, { action: "create", entity: "salary_advance", entityId: doc._id, ref: person.name, summary: `Recorded a salary advance for ${person.name}` });
    await notify([person._id], { type: "payroll", title: `A salary advance of ${inr(doc.amount, true)} was recorded`, body: `It will be recovered at ${inr(doc.monthlyRecovery, true)} a month from your payslips.`, link: "/payslips" }, [user._id]);
    return { id: doc._id.toString() };
  }, "Advance recorded");
}
