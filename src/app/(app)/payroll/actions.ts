"use server";

import { z } from "zod";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { runAction, actionPermission, ActionError, parse, type ActionResult } from "@/lib/actions";
import type { CurrentUser } from "@/lib/auth/session";
import { zs, isObjectId } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { notify, notifyMany, notifyPermission } from "@/lib/notify";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { inr, round2 } from "@/lib/format";
import { monthKey, todayKey } from "@/lib/time";
import { db } from "@/lib/db";
import { Expense, PayrollRun, Payslip, SalaryAdvance, User, newId, type Id, type IPayrollRun, type IPayslip, type PayLine } from "@/lib/models";
import { buildPayslips, payslipDoc, payslipFields, payslipInserts, runTotalsUpdate } from "@/lib/payroll/load";
import { isPeriod, type ManualLines } from "@/lib/payroll/calc";
import { KIND_LABEL, PAYROLL_PAYMENT_METHODS, periodLabel } from "@/lib/payroll/constants";
import { EXITED_STATUSES } from "@/lib/people";
import { increment, inList, isUniqueViolation, jsonPush, notInList } from "@/lib/sql";

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

const entry = (user: Pick<CurrentUser, "_id" | "name">, action: string, note?: string) => ({ _id: newId(), action, by: user._id, byName: user.name, at: new Date(), note });
const runTitle = (run: Pick<IPayrollRun, "kind" | "period" | "runNo">) => `${KIND_LABEL[run.kind]} run ${run.runNo} · ${periodLabel(run.period)}`;

async function loadRun(id: string): Promise<IPayrollRun> {
  if (!isObjectId(id)) throw new ActionError("Payroll run not found.");
  const [run] = await db().select().from(PayrollRun).where(eq(PayrollRun._id, id)).limit(1);
  if (!run) throw new ActionError("Payroll run not found.");
  return run;
}

/** Runs several statements as one D1 batch (one round trip, one transaction: all apply or none). */
async function runBatch(statements: BatchItem<"sqlite">[]): Promise<unknown[]> {
  if (statements.length === 0) return [];
  return (await db().batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]])) as unknown[];
}

/** `$addToSet` for a run's `editors`: appends the person only when absent (a single atomic expression). */
const addEditor = (userId: Id): SQL =>
  sql`case when exists (select 1 from json_each(${PayrollRun.editors}) where value = ${userId}) then ${PayrollRun.editors} else json_insert(${PayrollRun.editors}, '$[#]', ${userId}) end`;

/** True while the run has this status — lets a batch statement apply only if an earlier claim on the run succeeded. */
const runHasStatus = (runId: Id, status: IPayrollRun["status"]): SQL =>
  sql`exists (select 1 from ${PayrollRun} where ${PayrollRun._id} = ${runId} and ${PayrollRun.status} = ${status})`;

const manualOf = (lines: PayLine[]) => lines.filter((l) => l.source === "manual");
const linesText = (earnings: PayLine[], deductions: PayLine[]) =>
  [earnings.length ? `Earnings: ${earnings.map((l) => `${l.name} ${inr(l.amount, true)}`).join(", ")}` : "", deductions.length ? `Deductions: ${deductions.map((l) => `${l.name} ${inr(l.amount, true)}`).join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ") || "No manual lines";
const isEditor = (run: Pick<IPayrollRun, "editors">, user: CurrentUser) => (run.editors ?? []).includes(user.id);

/** Guards the writes of a long calculation against the run having been verified or cancelled in the meantime. */
async function assertStillDraft(runId: Id): Promise<void> {
  const [hit] = await db().select({ id: PayrollRun._id }).from(PayrollRun).where(and(eq(PayrollRun._id, runId), eq(PayrollRun.status, "draft"))).limit(1);
  if (!hit) throw new ActionError("This run was changed by someone else while it was being calculated. Reload and try again.");
}

/**
 * Every reimbursed expense in a run must still be approved and unpaid. A claim that was paid directly after the run
 * picked it up would otherwise be paid twice (once directly, once inside net pay).
 */
async function assertReimbursementsStillDue(runId: Id): Promise<void> {
  const slips = (await db().select({ reimbursedExpenses: Payslip.reimbursedExpenses, snapshot: Payslip.snapshot }).from(Payslip).where(eq(Payslip.run, runId))).filter((p) => p.reimbursedExpenses.length > 0);
  const ids = slips.flatMap((p) => p.reimbursedExpenses);
  if (ids.length === 0) return;
  const stillDue = new Set((await db().select({ id: Expense._id }).from(Expense).where(and(inList(Expense._id, ids), eq(Expense.status, "approved")))).map((e) => e.id));
  const stale = slips.filter((p) => p.reimbursedExpenses.some((e) => !stillDue.has(e)));
  if (stale.length > 0) {
    throw new ActionError(`Some reimbursements in this run were already paid or changed (${stale.slice(0, 3).map((p) => p.snapshot.name).join(", ")}). Send the run back to draft and recalculate it.`);
  }
}

/** Heals the (rare) case where a run was approved but its payslips were not all flipped to approved. */
async function ensurePayslipsApproved(run: IPayrollRun): Promise<void> {
  if (run.status === "approved") await db().update(Payslip).set({ status: "approved" }).where(and(eq(Payslip.run, run._id), eq(Payslip.status, "draft")));
}

/** Creates a payroll or stipend run for a month and generates its payslips. */
export async function createPayrollRun(input: Record<string, unknown>): Promise<ActionResult<{ id: string; skipped: string[] }>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare");
    const data = parse(runSchema, input);
    if (!isPeriod(data.period)) throw new ActionError("Choose a valid month.", { period: "Choose a valid month" });
    if (data.period > monthKey()) throw new ActionError("Payroll cannot be prepared for a future month.", { period: "Cannot be in the future" });

    const [clash] = await db()
      .select({ runNo: PayrollRun.runNo })
      .from(PayrollRun)
      .where(and(eq(PayrollRun.period, data.period), eq(PayrollRun.kind, data.kind), ne(PayrollRun.status, "cancelled")))
      .limit(1);
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
    const runId = newId();
    try {
      // The run, its payslips and its totals are written in one batch: all of it or nothing.
      await runBatch([
        db().insert(PayrollRun).values({
          _id: runId,
          runNo,
          period: data.period,
          kind: data.kind,
          activeKey: `${data.period}:${data.kind}`,
          status: "draft",
          workingDays: build.workingDays,
          preparedBy: user._id,
          preparedByName: user.name,
          history: [entry(user, "created")],
        }),
        ...payslipInserts(build.calcs.map((c) => ({ ...payslipDoc(c, { id: runId, period: data.period, kind: data.kind }), status: "draft" as const }))),
        runTotalsUpdate(runId, build.workingDays),
      ]);
    } catch (error) {
      // The unique activeKey stops two people creating the same run at the same moment.
      if (isUniqueViolation(error)) throw new ActionError(`A ${KIND_LABEL[data.kind].toLowerCase()} run for ${periodLabel(data.period)} already exists.`, { period: "A run already exists for this month" });
      throw error;
    }
    await audit(user, { action: "create", entity: "payroll_run", entityId: runId, ref: runNo, summary: `Created ${KIND_LABEL[data.kind].toLowerCase()} run ${runNo} for ${periodLabel(data.period)} with ${build.calcs.length} payslips` });
    return { id: runId, skipped };
  }, "Run created");
}

/** Recalculates every payslip of a draft run; manual lines and remarks are kept. */
export async function recalculateRun(id: string): Promise<ActionResult<{ added: number; removed: number }>> {
  return runAction(async () => {
    const user = await actionPermission("payroll.prepare");
    const run = await loadRun(id);
    if (run.status !== "draft") throw new ActionError("Only draft runs can be recalculated.");

    const existing = await db().select({ user: Payslip.user, earnings: Payslip.earnings, deductions: Payslip.deductions }).from(Payslip).where(eq(Payslip.run, run._id));
    const manual = new Map<string, ManualLines>(existing.map((p) => [p.user, { earnings: manualOf(p.earnings), deductions: manualOf(p.deductions) }]));
    const build = await buildPayslips({ period: run.period, kind: run.kind, runId: id, manual });
    await assertStillDraft(run._id);

    const known = new Set(existing.map((p) => p.user));
    const keep = new Set(build.calcs.map((c) => c.userId));
    const ref = { id, period: run.period, kind: run.kind };
    const updates = build.calcs
      .filter((calc) => known.has(calc.userId))
      .map((calc) => db().update(Payslip).set(payslipFields(calc)).where(and(eq(Payslip.run, run._id), eq(Payslip.user, calc.userId), eq(Payslip.status, "draft"))));
    const fresh = build.calcs.filter((calc) => !known.has(calc.userId));
    const added = fresh.length;
    const removedUsers = [...known].filter((u) => !keep.has(u));
    // Payslip changes, the run's totals and its edit trail are applied together.
    await runBatch([
      ...updates,
      ...payslipInserts(fresh.map((calc) => ({ ...payslipDoc(calc, ref), status: "draft" as const }))),
      ...(removedUsers.length ? [db().delete(Payslip).where(and(eq(Payslip.run, run._id), inList(Payslip.user, removedUsers), eq(Payslip.status, "draft")))] : []),
      runTotalsUpdate(run._id, build.workingDays),
      db().update(PayrollRun).set({ history: jsonPush(PayrollRun.history, entry(user, "recalculated")), editors: addEditor(user._id) }).where(eq(PayrollRun._id, run._id)),
    ]);
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
    const [slip] = await db().select().from(Payslip).where(eq(Payslip._id, payslipId)).limit(1);
    if (!slip) throw new ActionError("Payslip not found.");
    const run = await loadRun(slip.run);
    if (run.status !== "draft" || slip.status !== "draft") throw new ActionError("Approved and paid payslips are locked. Only draft runs can be edited.");
    if (!user.isSuperAdmin && slip.user === user.id) throw new ActionError("You can't edit your own payslip. Ask another payroll preparer.");

    const toLines = (lines: { name: string; amount: number }[], prefix: string): PayLine[] =>
      lines.filter((l) => l.amount > 0).map((l, i) => ({ key: `${prefix}:${i}`, name: l.name, amount: round2(l.amount), source: "manual" as const }));
    const manual = new Map<string, ManualLines>([[slip.user, { earnings: toLines(data.earnings, "manual-earning"), deductions: toLines(data.deductions, "manual-deduction") }]]);
    // Rebuild this one payslip so advance recovery still respects the new net pay.
    const build = await buildPayslips({ period: run.period, kind: run.kind, runId: run._id, manual, only: [slip.user] });
    const calc = build.calcs[0];
    if (!calc) throw new ActionError("This person is no longer eligible for the run. Recalculate the run to refresh it.");
    await assertStillDraft(run._id);
    // The amounts are kept on the payslip and the run (both only readable with `payroll.view`), never in the audit trail.
    const change = { ...entry(user, "lines_edited", data.remarks || undefined), from: linesText(manualOf(slip.earnings), manualOf(slip.deductions)), to: linesText(calc.earnings.filter((l) => l.source === "manual"), calc.deductions.filter((l) => l.source === "manual")) };
    await runBatch([
      db()
        .update(Payslip)
        .set({ ...payslipFields(calc), remarks: data.remarks ?? "", history: jsonPush(Payslip.history, change) })
        .where(and(eq(Payslip._id, slip._id), eq(Payslip.status, "draft"))),
      db()
        .update(PayrollRun)
        .set({ editors: addEditor(user._id), history: jsonPush(PayrollRun.history, entry(user, "lines_edited", `${slip.snapshot.name}: ${change.to}`)) })
        .where(eq(PayrollRun._id, run._id)),
      runTotalsUpdate(run._id),
    ]);
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
    const [updated] = await db()
      .update(PayrollRun)
      .set({ status: "verified", verifiedBy: user._id, verifiedByName: user.name, verifiedAt: new Date(), history: jsonPush(PayrollRun.history, entry(user, "verified")) })
      .where(and(eq(PayrollRun._id, run._id), eq(PayrollRun.status, "draft")))
      .returning({ id: PayrollRun._id });
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
    const [updated] = await db()
      .update(PayrollRun)
      .set({ status: "draft", verifiedBy: null, verifiedByName: null, verifiedAt: null, history: jsonPush(PayrollRun.history, entry(user, "returned", note)) })
      .where(and(eq(PayrollRun._id, run._id), eq(PayrollRun.status, "verified")))
      .returning({ id: PayrollRun._id });
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
    if (!user.isSuperAdmin && ([run.preparedBy, run.verifiedBy].some((p) => p === user.id) || isEditor(run, user))) {
      throw new ActionError("You prepared, verified or edited payslips in this run, so someone else must approve it.");
    }
    if (run.status === "verified") await assertReimbursementsStillDue(run._id);
    // Approving the run and flipping its draft payslips to approved is one batch; the second statement only applies once the run is approved.
    const [updated] = (await runBatch([
      db()
        .update(PayrollRun)
        .set({ status: "approved", approvedBy: user._id, approvedByName: user.name, approvedAt: new Date(), history: jsonPush(PayrollRun.history, entry(user, "approved")) })
        .where(and(eq(PayrollRun._id, run._id), eq(PayrollRun.status, "verified")))
        .returning({ id: PayrollRun._id }),
      db()
        .update(Payslip)
        .set({ status: "approved" })
        .where(and(eq(Payslip.run, run._id), eq(Payslip.status, "draft"), runHasStatus(run._id, "approved"))),
    ])) as { id: string }[][];
    if (!updated.length) throw new ActionError("Only verified runs can be approved.");
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
    // The dialog promises the payslips are discarded; drafts of a cancelled run must not linger in reports.
    const [updated] = (await runBatch([
      db()
        .update(PayrollRun)
        .set({ status: "cancelled", activeKey: null, history: jsonPush(PayrollRun.history, entry(user, "cancelled", note)) })
        .where(and(eq(PayrollRun._id, run._id), inList(PayrollRun.status, ["draft", "verified"])))
        .returning({ id: PayrollRun._id }),
      db().delete(Payslip).where(and(eq(Payslip.run, run._id), eq(Payslip.status, "draft"), runHasStatus(run._id, "cancelled"))),
    ])) as { id: string }[][];
    if (!updated.length) throw new ActionError("Only draft or verified runs can be cancelled. Approved and paid runs are locked.");
    await audit(user, { action: "cancel", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `Cancelled ${runTitle(run)}: ${note}`, changes: [{ field: "status", from: run.status, to: "cancelled" }] });
    return null;
  }, "Run cancelled");
}

/**
 * Marks approved payslips as paid and applies their side effects exactly once: advance recoveries, the reimbursed
 * expenses and the "payslip is ready" notification. Returns the payslips this call actually paid.
 *
 * Every payslip's writes (recoveries, expense flips, the status flip) go into one D1 batch (one transaction, so no
 * half-settled payslip) and are individually guarded: a recovery is recorded once per payslip, an expense is only
 * flipped while it is still approved, and the status flip (`status = approved`) is the claim that decides who sends
 * the notification — two people clicking at the same moment cannot apply anything twice.
 */
async function settlePayslips(slips: IPayslip[], pay: z.infer<typeof paymentSchema>, actor: CurrentUser): Promise<IPayslip[]> {
  const due = slips.filter((s) => s.status === "approved");
  const claimed: IPayslip[] = [];
  // A few hundred statements in one batch is fine, but keep each batch modest.
  const STATEMENTS_PER_BATCH = 90;
  let group: IPayslip[] = [];
  let size = 0;
  const flush = async () => {
    if (group.length) claimed.push(...(await settleGroup(group, pay, actor)));
    group = [];
    size = 0;
  };
  for (const slip of due) {
    const cost = slip.advanceRecoveries.length * 2 + (slip.reimbursedExpenses.length ? 1 : 0) + 1;
    if (size + cost > STATEMENTS_PER_BATCH) await flush();
    group.push(slip);
    size += cost;
  }
  await flush();

  await notifyMany(
    claimed.map((slip) => ({
      recipients: [slip.user],
      input: {
        type: "payroll",
        title: `Your payslip for ${periodLabel(slip.period)} is ready`,
        body: `Net pay ${inr(slip.net, true)} paid on ${pay.date}.`,
        link: `/payslips/${slip._id}`,
      },
    })),
  );
  return claimed;
}

async function settleGroup(group: IPayslip[], pay: z.infer<typeof paymentSchema>, actor: CurrentUser): Promise<IPayslip[]> {
  const statements: BatchItem<"sqlite">[] = [];
  const plans = group.map((slip) => {
    const plan = { slip, recoveries: [] as number[], expenses: undefined as number | undefined, claim: -1 };
    for (const r of slip.advanceRecoveries) {
      plan.recoveries.push(statements.length);
      statements.push(
        db()
          .update(SalaryAdvance)
          .set({
            recovered: increment(SalaryAdvance.recovered, r.amount),
            recoveries: jsonPush(SalaryAdvance.recoveries, { period: slip.period, amount: r.amount, payslip: slip._id }),
          })
          .where(
            and(
              eq(SalaryAdvance._id, r.advance),
              sql`not exists (select 1 from json_each(${SalaryAdvance.recoveries}) where json_extract(value, '$.payslip') = ${slip._id})`,
              // Never recover more than the advance (a stale run could otherwise over-recover).
              sql`round(coalesce(${SalaryAdvance.recovered}, 0) + ${r.amount}, 2) <= ${SalaryAdvance.amount} + 0.005`,
            ),
          )
          .returning({ id: SalaryAdvance._id }),
      );
      statements.push(db().update(SalaryAdvance).set({ status: "closed" }).where(and(eq(SalaryAdvance._id, r.advance), eq(SalaryAdvance.status, "open"), sql`round(${SalaryAdvance.recovered}, 2) >= ${SalaryAdvance.amount}`)));
    }
    if (slip.reimbursedExpenses.length > 0) {
      plan.expenses = statements.length;
      statements.push(
        db()
          .update(Expense)
          .set({
            status: "paid",
            payment: { date: pay.date, method: pay.method, reference: pay.reference, viaPayroll: true, by: actor._id, byName: actor.name },
            history: jsonPush(Expense.history, entry(actor, "paid", `Reimbursed with ${periodLabel(slip.period)} payroll`)),
          })
          .where(and(inList(Expense._id, slip.reimbursedExpenses), eq(Expense.status, "approved")))
          .returning({ id: Expense._id }),
      );
    }
    plan.claim = statements.length;
    statements.push(
      db()
        .update(Payslip)
        .set({ status: "paid", payment: { date: pay.date, method: pay.method, reference: pay.reference, by: actor._id, byName: actor.name, at: new Date() } })
        .where(and(eq(Payslip._id, slip._id), eq(Payslip.status, "approved")))
        .returning({ id: Payslip._id }),
    );
    return plan;
  });

  const results = await runBatch(statements);
  const rows = (index: number) => results[index] as { id: string }[];
  const claimed: IPayslip[] = [];
  for (const { slip, recoveries, expenses, claim } of plans) {
    for (const index of recoveries) {
      if (rows(index).length === 0) console.warn(`[payroll] advance recovery of payslip ${slip._id} was not applied (already recorded or beyond the advance)`);
    }
    if (expenses !== undefined) {
      const flipped = rows(expenses).length;
      if (flipped < slip.reimbursedExpenses.length) {
        // Some claims were paid separately before this payslip was paid: leave a trace so Finance can reclaim the money.
        await audit(actor, { action: "payment", entity: "payslip", entityId: slip._id, ref: slip.snapshot.name, summary: `Check for a duplicate reimbursement: ${slip.reimbursedExpenses.length - flipped} claim(s) on the ${periodLabel(slip.period)} payslip of ${slip.snapshot.name} had already been paid` });
      }
    }
    if (rows(claim).length > 0) claimed.push(slip);
  }
  return claimed;
}

/** Marks the run as paid once every payslip is paid. */
async function closeRunIfComplete(run: IPayrollRun, actor: CurrentUser): Promise<boolean> {
  const open = await db().$count(Payslip, and(eq(Payslip.run, run._id), ne(Payslip.status, "paid")));
  if (open > 0) return false;
  const closed = await db()
    .update(PayrollRun)
    .set({ status: "paid", paidAt: new Date(), history: jsonPush(PayrollRun.history, entry(actor, "paid")) })
    .where(and(eq(PayrollRun._id, run._id), eq(PayrollRun.status, "approved")))
    .returning({ id: PayrollRun._id });
  if (closed.length > 0) await audit(actor, { action: "payment", entity: "payroll_run", entityId: run._id, ref: run.runNo, summary: `${runTitle(run)} fully paid`, changes: [{ field: "status", from: "approved", to: "paid" }] });
  return closed.length > 0;
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
    const [slip] = await db().select().from(Payslip).where(eq(Payslip._id, payslipId)).limit(1);
    if (!slip) throw new ActionError("Payslip not found.");
    const run = await loadRun(slip.run);
    if (run.status !== "approved") throw new ActionError("Payments can only be recorded for approved runs.");
    if (!user.isSuperAdmin && isEditor(run, user)) throw new ActionError("You edited payslips in this run, so someone else must record its payment.");
    await ensurePayslipsApproved(run);
    const [fresh] = await db().select().from(Payslip).where(eq(Payslip._id, slip._id)).limit(1);
    if (!fresh || (await settlePayslips([fresh], pay, user)).length === 0) throw new ActionError("This payslip is not awaiting payment.");
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
    const slips = await db().select().from(Payslip).where(and(eq(Payslip.run, run._id), eq(Payslip.status, "approved")));
    if (slips.length === 0) throw new ActionError("There are no payslips awaiting payment.");
    const paid = (await settlePayslips(slips, pay, user)).length;
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
    const [person] = await db()
      .select({ _id: User._id, name: User.name })
      .from(User)
      .where(and(eq(User._id, data.user), inList(User.personType, ["employee", "trainee", "intern"]), notInList(User.status, EXITED_STATUSES)))
      .limit(1);
    if (!person) throw new ActionError("Choose a current employee, trainee or intern.", { user: "Choose a person" });

    const [doc] = await db()
      .insert(SalaryAdvance)
      .values({
        user: person._id,
        amount: round2(data.amount),
        date: data.date,
        reason: data.reason,
        monthlyRecovery: round2(data.monthlyRecovery),
        recordedBy: user._id,
        recordedByName: user.name,
      })
      .returning();
    await audit(user, { action: "create", entity: "salary_advance", entityId: doc._id, ref: person.name, summary: `Recorded a salary advance for ${person.name}` });
    await notify([person._id], { type: "payroll", title: `A salary advance of ${inr(doc.amount, true)} was recorded`, body: `It will be recovered at ${inr(doc.monthlyRecovery, true)} a month from your payslips.`, link: "/payslips" }, [user._id]);
    return { id: doc._id };
  }, "Advance recorded");
}
