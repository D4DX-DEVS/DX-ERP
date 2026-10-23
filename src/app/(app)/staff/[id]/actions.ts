"use server";

import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { can, revokeUserSessions, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { inr } from "@/lib/format";
import {
  Asset,
  Attendance,
  Department,
  Designation,
  LeaveRequest,
  LearningResource,
  Movement,
  Notification,
  Payslip,
  Review,
  Role,
  Session,
  StoredFile,
  Task,
  TimesheetEntry,
  User,
  newId,
} from "@/lib/models";
import { notify, notifyPermission } from "@/lib/notify";
import { inList, jsonHas, jsonPath, jsonPush } from "@/lib/sql";
import { getSettings } from "@/lib/settings";
import { addDays, fmtDate } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { adviseRotationForUser } from "@/lib/vault/service";
import { AUTO_ONBOARDING_KEY, salaryTotals } from "../_lib/constants";
import {
  autoCompleteSteps,
  buildSalary,
  lifecycleEvent,
  parseMoneyLines,
  setOnboardingStep,
} from "../_lib/person";

const EXITED = ["resigned", "terminated", "inactive"];
const effectiveDate = zs.date("Effective date");
const note = zs.optText(500);
const OWN_RECORD = "You can't change your own employment record. Ask another HR administrator.";

/** Columns the lifecycle actions need (never the big history / salary history / bank columns). */
const targetColumns = {
  _id: User._id,
  employeeId: User.employeeId,
  name: User.name,
  personType: User.personType,
  role: User.role,
  designation: User.designation,
  department: User.department,
  reportingManager: User.reportingManager,
  status: User.status,
  accountActive: User.accountActive,
  salary: User.salary,
  exit: User.exit,
  internship: User.internship,
};

async function staffTarget(id: string) {
  if (!isObjectId(id)) throw new ActionError("Person not found.");
  const [target] = await db().select(targetColumns).from(User).where(eq(User._id, id)).limit(1);
  if (!target || target.personType === "admin") throw new ActionError("Person not found.");
  return target;
}

/** `{ id → name }` lookup of one table's row names (two parallel single-row reads are not worth a helper table). */
const oneName = async (rows: Promise<{ name: string }[]>): Promise<string | undefined> => (await rows)[0]?.name;

/** Delegated admins can't disable, sign out or delete people whose role carries permissions they don't hold (same ceiling as `changeRole`). */
async function assertRoleCeiling(user: CurrentUser, target: { name: string; role: string }): Promise<void> {
  if (user.isSuperAdmin) return;
  const [role] = await db().select({ permissions: Role.permissions }).from(Role).where(eq(Role.key, target.role)).limit(1);
  const own = new Set<string>(user.permissions);
  if (role?.permissions.some((p) => !own.has(p))) throw new ActionError(`${target.name}'s role has permissions you don't hold. Ask the super admin.`);
}

/** Exited by status key or by the category of a custom employment status. */
async function hasExited(status: string): Promise<boolean> {
  if (EXITED.includes(status)) return true;
  const settings = await getSettings();
  return settings.employmentStatuses.find((s) => s.key === status)?.category === "exited";
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export async function changeDesignation(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    const data = parse(
      z.object({ userId: zs.id("Person"), kind: z.enum(["promotion", "designation_change"]), designation: zs.id("Designation"), effectiveDate, note }),
      input,
    );
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    if (target.designation === data.designation) throw new ActionError("This is already the current designation.", { designation: "Already current" });
    const [nextName, prevName] = await Promise.all([
      oneName(db().select({ name: Designation.name }).from(Designation).where(eq(Designation._id, data.designation)).limit(1)),
      target.designation ? oneName(db().select({ name: Designation.name }).from(Designation).where(eq(Designation._id, target.designation)).limit(1)) : undefined,
    ]);
    if (!nextName) throw new ActionError("Designation not found.", { designation: "Not found" });
    const next = { _id: data.designation, name: nextName };
    const prev = prevName ? { name: prevName } : undefined;
    const summary = data.kind === "promotion" ? `Promoted to ${next.name}` : `Designation changed to ${next.name}`;
    await db()
      .update(User)
      .set({
        designation: next._id,
        history: jsonPush(User.history, lifecycleEvent(user, { type: data.kind, date: data.effectiveDate, summary, from: prev?.name, to: next.name, note: data.note })),
      })
      .where(eq(User._id, target._id));
    await autoCompleteSteps(target._id);
    await audit(user, {
      action: "update",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `${summary} — ${target.name}`,
      changes: [{ field: "designation", from: prev?.name, to: next.name }],
    });
    await notify(
      [target._id],
      {
        type: "system",
        title: data.kind === "promotion" ? "Congratulations on your promotion" : "Your designation was updated",
        body: `Your designation is now ${next.name}.`,
        link: "/profile",
      },
      [user._id],
    );
    return null;
  }, "Designation updated");
}

export async function transferDepartment(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    const data = parse(z.object({ userId: zs.id("Person"), department: zs.id("Department"), effectiveDate, note }), input);
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    if (target.department === data.department) throw new ActionError("This is already the current department.", { department: "Already current" });
    const [nextName, prevName] = await Promise.all([
      oneName(db().select({ name: Department.name }).from(Department).where(eq(Department._id, data.department)).limit(1)),
      target.department ? oneName(db().select({ name: Department.name }).from(Department).where(eq(Department._id, target.department)).limit(1)) : undefined,
    ]);
    if (!nextName) throw new ActionError("Department not found.", { department: "Not found" });
    const next = { _id: data.department, name: nextName };
    const prev = prevName ? { name: prevName } : undefined;
    const summary = `Transferred to ${next.name}`;
    await db()
      .update(User)
      .set({
        department: next._id,
        history: jsonPush(User.history, lifecycleEvent(user, { type: "department_change", date: data.effectiveDate, summary, from: prev?.name, to: next.name, note: data.note })),
      })
      .where(eq(User._id, target._id));
    await autoCompleteSteps(target._id);
    await audit(user, {
      action: "update",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `${summary} — ${target.name}`,
      changes: [{ field: "department", from: prev?.name, to: next.name }],
    });
    await notify([target._id], { type: "system", title: "Your department was updated", body: `You are now part of ${next.name}.`, link: "/profile" }, [user._id]);
    return null;
  }, "Department updated");
}

export async function changeManager(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    const data = parse(z.object({ userId: zs.id("Person"), reportingManager: zs.optId(), effectiveDate, note }), input);
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    const current = target.reportingManager ?? undefined;
    if (data.reportingManager === data.userId) throw new ActionError("A person can't report to themself.", { reportingManager: "Invalid" });
    if ((data.reportingManager ?? undefined) === current) throw new ActionError("This is already the current reporting manager.", { reportingManager: "Already current" });

    let next: { name: string } | null = null;
    if (data.reportingManager) {
      const [manager] = await db().select({ name: User.name, personType: User.personType, status: User.status }).from(User).where(eq(User._id, data.reportingManager)).limit(1);
      if (!manager || manager.personType === "admin" || EXITED.includes(manager.status)) {
        throw new ActionError("Choose an active staff member as reporting manager.", { reportingManager: "Not available" });
      }
      // Walk up the chain to make sure the new manager does not (transitively) report to this person.
      // One read of the (id, manager) pairs instead of one query per level.
      const links = await db().select({ id: User._id, manager: User.reportingManager }).from(User).where(isNotNull(User.reportingManager));
      const managerOf = new Map(links.map((l) => [l.id, l.manager]));
      let cursor: string | null | undefined = data.reportingManager;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === data.userId) throw new ActionError("That would create a reporting loop.", { reportingManager: "Creates a loop" });
        cursor = managerOf.get(cursor);
      }
      next = manager;
    }
    const prevName = current ? await oneName(db().select({ name: User.name }).from(User).where(eq(User._id, current)).limit(1)) : undefined;
    const prev = prevName ? { name: prevName } : undefined;
    const summary = next ? `Reporting manager changed to ${next.name}` : "Reporting manager removed";
    await db()
      .update(User)
      .set({
        reportingManager: next ? (data.reportingManager ?? null) : null,
        history: jsonPush(User.history, lifecycleEvent(user, { type: "manager_change", date: data.effectiveDate, summary, from: prev?.name, to: next?.name, note: data.note })),
      })
      .where(eq(User._id, target._id));
    await autoCompleteSteps(target._id);
    await audit(user, {
      action: "update",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `${summary} — ${target.name}`,
      changes: [{ field: "reportingManager", from: prev?.name, to: next?.name }],
    });
    const type = target.personType === "employee" ? "system" : "internship";
    await notify([target._id], { type: "system", title: "Your reporting manager changed", body: next ? `You now report to ${next.name}.` : "You no longer have a reporting manager assigned.", link: "/profile" }, [user._id]);
    if (data.reportingManager) {
      await notify([data.reportingManager], { type, title: `${target.name} now reports to you`, link: `/staff/${data.userId}` }, [user._id]);
    }
    if (current) await notify([current], { type, title: `${target.name} no longer reports to you`, link: `/staff/${data.userId}` }, [user._id, data.reportingManager]);
    return null;
  }, "Reporting manager updated");
}

export async function changeStatus(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    const data = parse(z.object({ userId: zs.id("Person"), status: zs.text("Status", 40), effectiveDate, note }), input);
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    const settings = await getSettings();
    const option = settings.employmentStatuses.find((s) => s.key === data.status);
    if (!option) throw new ActionError("Choose a valid status.", { status: "Invalid" });
    if (option.category === "exited") throw new ActionError("Use “Complete exit” to mark someone as resigned or terminated.", { status: "Use Complete exit" });
    if (option.category === "notice") throw new ActionError("Use “Record resignation” to start a notice period.", { status: "Use Record resignation" });
    if (target.status === option.key) throw new ActionError("This is already the current status.", { status: "Already current" });
    const prevLabel = settings.employmentStatuses.find((s) => s.key === target.status)?.label ?? target.status;

    let exit = target.exit;
    let summary = `Status changed to ${option.label}`;
    const reopened = (option.category === "active" || option.category === "leave") && (target.exit?.stage === "notice" || target.exit?.stage === "completed");
    if (reopened) {
      // Stage back to "none"; the resignation / exit details are cleared.
      exit = { stage: "none" };
      summary = target.exit?.stage === "notice" ? `Resignation withdrawn — status ${option.label}` : `Re-activated — status ${option.label}`;
    }
    await db()
      .update(User)
      .set({
        status: option.key,
        ...(reopened ? { exit } : {}),
        history: jsonPush(User.history, lifecycleEvent(user, { type: "status_change", date: data.effectiveDate, summary, from: prevLabel, to: option.label, note: data.note })),
      })
      .where(eq(User._id, target._id));
    if (option.category === "inactive") await revokeUserSessions(target._id, "status set to inactive");
    await audit(user, {
      action: "status",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `${summary} — ${target.name}`,
      changes: [{ field: "status", from: prevLabel, to: option.label }],
    });
    return null;
  }, "Status updated");
}

export async function recordResignation(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    const data = parse(
      z.object({ userId: zs.id("Person"), resignationDate: zs.date("Resignation date"), noticeDays: zs.num("Notice period", { min: 0, max: 365 }), reason: zs.optText(1000) }),
      input,
    );
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    if (target.exit?.stage === "notice") throw new ActionError("A resignation is already recorded for this person.");
    if (target.exit?.stage === "completed" || EXITED.includes(target.status)) throw new ActionError("This person has already left.");
    const settings = await getSettings();
    const noticeStatus = settings.employmentStatuses.find((s) => s.category === "notice") ?? { key: "notice", label: "Notice period" };
    const noticeDays = Math.round(data.noticeDays);
    const lastWorkingDay = addDays(data.resignationDate, noticeDays);
    const prevLabel = settings.employmentStatuses.find((s) => s.key === target.status)?.label ?? target.status;
    await db()
      .update(User)
      .set({
        status: noticeStatus.key,
        exit: {
          ...target.exit,
          stage: "notice",
          resignationDate: data.resignationDate,
          noticeDays,
          lastWorkingDay,
          ...(data.reason ? { reason: data.reason } : {}),
        },
        history: jsonPush(
          User.history,
          lifecycleEvent(user, {
            type: "resignation",
            date: data.resignationDate,
            summary: `Resignation recorded — last working day ${fmtDate(lastWorkingDay)}`,
            from: prevLabel,
            to: noticeStatus.label,
            note: data.reason,
          }),
        ),
      })
      .where(eq(User._id, target._id));
    await audit(user, {
      action: "status",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `Resignation recorded for ${target.name}; last working day ${lastWorkingDay}`,
      changes: [{ field: "status", from: prevLabel, to: noticeStatus.label }],
    });
    const body = `${target.name} (${target.employeeId}) — last working day ${fmtDate(lastWorkingDay)}.`;
    await notifyPermission("staff.edit", { type: "system", title: "Resignation recorded", body, link: `/staff/${data.userId}?tab=history`, actionable: true }, [user._id]);
    await notify([target.reportingManager], { type: "system", title: `${target.name} has resigned`, body, link: `/staff/${data.userId}` }, [user._id]);
    return null;
  }, "Resignation recorded");
}

export async function completeExit(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    const data = parse(z.object({ userId: zs.id("Person"), status: zs.text("Status", 40), exitDate: zs.date("Exit date"), clearanceNote: zs.optText(1000) }), input);
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    if (target.exit?.stage === "completed") throw new ActionError("The exit has already been completed.");
    const settings = await getSettings();
    const option = settings.employmentStatuses.find((s) => s.key === data.status && s.category === "exited");
    if (!option) throw new ActionError("Choose Resigned or Terminated.", { status: "Invalid" });
    const prevLabel = settings.employmentStatuses.find((s) => s.key === target.status)?.label ?? target.status;
    await db()
      .update(User)
      .set({
        status: option.key,
        accountActive: false,
        exit: { ...target.exit, stage: "completed", lastWorkingDay: data.exitDate, ...(data.clearanceNote ? { clearanceNote: data.clearanceNote } : {}) },
        ...(target.internship && ["registered", "active", "extended"].includes(target.internship.status) ? { internship: { ...target.internship, status: "terminated" as const } } : {}),
        history: jsonPush(User.history, lifecycleEvent(user, { type: "exit", date: data.exitDate, summary: `Exit completed — ${option.label}`, from: prevLabel, to: option.label, note: data.clearanceNote })),
      })
      .where(eq(User._id, target._id));
    await revokeUserSessions(target._id, "exit completed");
    await adviseRotationForUser(target._id, `${target.name} left the company after accessing it`);
    await audit(user, {
      action: "status",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `Exit completed for ${target.name} (${option.label}); login access revoked`,
      changes: [
        { field: "status", from: prevLabel, to: option.label },
        { field: "accountActive", from: target.accountActive, to: false },
      ],
    });
    await notify([target.reportingManager, target.internship?.mentor], { type: "system", title: `${target.name} has left`, body: `Exit completed (${option.label}).`, link: `/staff/${data.userId}` }, [user._id]);
    return null;
  }, "Exit completed — login access revoked");
}

/* ------------------------------------------------------------------ */
/* Onboarding checklist                                                */
/* ------------------------------------------------------------------ */

export async function toggleOnboardingStep(userId: string, key: string, done: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.edit");
    const target = await staffTarget(userId);
    if (key === AUTO_ONBOARDING_KEY) throw new ActionError("The first sign-in step is marked automatically.");
    if (typeof key !== "string" || !/^[a-z_]{1,30}$/.test(key)) throw new ActionError("Unknown step.");
    await setOnboardingStep(target._id, key, Boolean(done), user._id);
    await audit(user, {
      action: "update",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `${done ? "Completed" : "Reopened"} onboarding step “${key.replace(/_/g, " ")}” for ${target.name}`,
    });
    return null;
  });
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

async function documentActor(personId: string) {
  const user = await actionUser();
  if (!isObjectId(personId)) throw new ActionError("Person not found.");
  const [target] = await db().select({ _id: User._id, personType: User.personType, name: User.name, employeeId: User.employeeId }).from(User).where(eq(User._id, personId)).limit(1);
  if (!target || target.personType === "admin") throw new ActionError("Person not found.");
  const internLike = target.personType === "intern" || target.personType === "trainee";
  const self = user.id === personId;
  const manage = can(user, "staff.edit") || (internLike && can(user, "interns.manage"));
  if (!self && !manage) throw new ActionError("You don't have permission to manage this person's documents.");
  return { user, target, self, manage };
}

const registerSchema = z.object({
  personId: zs.id("Person"),
  fileId: zs.ids(),
  category: zs.text("Category", 60),
  expiryDate: zs.optDate(),
  confidential: zs.bool(),
  notes: zs.optText(500),
  replaces: zs.optId(),
});

/**
 * Finalises an uploaded file as a categorised document of a person: sets category, expiry and
 * confidentiality, links version history and refreshes the onboarding checklist.
 */
export async function registerDocument(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const data = parse(registerSchema, input);
    const { user, target, self, manage } = await documentActor(data.personId);
    const fileId = data.fileId[0];
    if (!fileId) throw new ActionError("Attach a file first.", { fileId: "Attach a file" });

    const settings = await getSettings();
    const category = settings.documentCategories.find((c) => c.key === data.category);
    if (!category || !category.appliesTo.includes(target.personType)) throw new ActionError("Choose a document category.", { category: "Invalid category" });
    if (!manage && category.confidential) throw new ActionError("This document is confidential — please hand it to HR to upload.", { category: "HR uploads this category" });

    const [file] = await db().select().from(StoredFile).where(eq(StoredFile._id, fileId)).limit(1);
    if (!file || file.deletedAt || file.entityType !== "user" || file.entityId !== data.personId) throw new ActionError("Uploaded file not found. Please upload it again.", { fileId: "Upload again" });
    if (file.uploadedBy !== user.id) throw new ActionError("You can only register files you uploaded.");
    if (file.category) throw new ActionError("This file is already registered.");

    const set: Partial<typeof StoredFile.$inferInsert> = {
      category: category.key,
      confidential: category.confidential || data.confidential,
    };
    if (data.expiryDate) set.expiryDate = data.expiryDate;
    if (data.notes) set.notes = data.notes;

    if (data.replaces) {
      const [old] = await db().select().from(StoredFile).where(eq(StoredFile._id, data.replaces)).limit(1);
      if (!old || old.deletedAt || old.entityType !== "user" || old.entityId !== data.personId || old.category !== category.key) {
        throw new ActionError("The document to replace was not found in this category.");
      }
      if (!manage && (old.confidential || old.uploadedBy !== user.id)) throw new ActionError("Only HR can replace this document.");
      const linked = await db()
        .update(StoredFile)
        .set({ replacedBy: file._id })
        .where(and(eq(StoredFile._id, old._id), isNull(StoredFile.replacedBy)))
        .returning({ id: StoredFile._id });
      if (linked.length === 0) throw new ActionError("This document has already been replaced — refresh and try again.");
      set.replaces = old._id;
      set.version = (old.version ?? 1) + 1;
    }
    await db().update(StoredFile).set(set).where(eq(StoredFile._id, file._id));
    await autoCompleteSteps(data.personId);

    await audit(user, {
      action: data.replaces ? "update" : "create",
      entity: "document",
      entityId: file._id,
      ref: target.employeeId,
      summary: `${data.replaces ? "Uploaded new version of" : "Uploaded"} ${category.label} for ${target.name}`,
    });
    if (!self) {
      await notify([target._id], { type: "document", title: "A document was added to your record", body: category.label, link: "/profile" }, [user._id]);
    }
    return null;
  }, "Document saved");
}

/** Soft-deletes a document; an older version (if any) becomes current again. */
export async function deleteDocument(personId: string, fileId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { user, target, manage } = await documentActor(personId);
    if (!manage) throw new ActionError("You don't have permission to delete documents.");
    if (!isObjectId(fileId)) throw new ActionError("Document not found.");
    const [file] = await db().select().from(StoredFile).where(eq(StoredFile._id, fileId)).limit(1);
    if (!file || file.deletedAt || file.entityType !== "user" || file.entityId !== personId) throw new ActionError("Document not found.");
    await db().update(StoredFile).set({ deletedAt: new Date(), deletedBy: user._id }).where(eq(StoredFile._id, file._id));
    if (file.replaces) await db().update(StoredFile).set({ replacedBy: null }).where(and(eq(StoredFile._id, file.replaces), eq(StoredFile.replacedBy, file._id)));
    await audit(user, { action: "delete", entity: "document", entityId: file._id, ref: target.employeeId, summary: `Deleted document “${file.name}” of ${target.name}` });
    return null;
  }, "Document deleted");
}

/* ------------------------------------------------------------------ */
/* Salary & stipend (confidential)                                     */
/* ------------------------------------------------------------------ */

export async function reviseSalary(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.confidential");
    if (!can(user, "staff.edit")) throw new ActionError("You need permission to edit staff records to revise salary.");
    const data = parse(z.object({ userId: zs.id("Person"), basic: zs.num("Basic salary", { min: 0 }), effectiveFrom: zs.date("Effective from"), note }), input);
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    const allowances = parseMoneyLines(input.allowanceName, input.allowanceAmount, "Allowance");
    const deductions = parseMoneyLines(input.deductionName, input.deductionAmount, "Deduction");
    const next = buildSalary({ basic: data.basic, allowances, deductions, effectiveFrom: data.effectiveFrom });
    const nextTotals = salaryTotals(next);
    const prevTotals = target.salary ? salaryTotals(target.salary) : null;
    await db()
      .update(User)
      .set({
        salary: next,
        salaryHistory: jsonPush(User.salaryHistory, { ...next, _id: newId(), note: data.note, by: user._id, byName: user.name, at: new Date() }),
        history: jsonPush(
          User.history,
          lifecycleEvent(user, {
            type: "salary_revision",
            date: data.effectiveFrom,
            summary: `Salary revised — gross ${inr(nextTotals.gross)} / month`,
            from: prevTotals ? inr(prevTotals.gross) : undefined,
            to: inr(nextTotals.gross),
            note: data.note,
            confidential: true,
          }),
        ),
      })
      .where(eq(User._id, target._id));
    // Amounts are intentionally left out of the audit trail (it is readable without staff.confidential).
    await audit(user, { action: "update", entity: "user", entityId: target._id, ref: target.employeeId, summary: `Revised salary of ${target.name} (effective ${data.effectiveFrom})` });
    return null;
  }, "Salary revised");
}

export async function reviseStipend(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.confidential");
    if (!can(user, "staff.edit") && !can(user, "interns.manage")) throw new ActionError("You don't have permission to revise stipends.");
    const data = parse(
      z.object({
        userId: zs.id("Person"),
        eligible: zs.bool(),
        amount: zs.num("Stipend amount", { min: 0 }),
        period: z.enum(["monthly", "one_time"]),
        effectiveFrom: zs.date("Effective from"),
        note,
      }),
      input,
    );
    const target = await staffTarget(data.userId);
    if (target._id === user.id) throw new ActionError(OWN_RECORD);
    if ((target.personType !== "intern" && target.personType !== "trainee") || !target.internship) throw new ActionError("Only interns and trainees have a stipend.");
    const amount = Math.round(data.amount * 100) / 100;
    await db()
      .update(User)
      .set({
        internship: {
          ...target.internship,
          stipend: { eligible: data.eligible, amount, period: data.period },
          stipendHistory: [...(target.internship.stipendHistory ?? []), { _id: newId(), amount, effectiveFrom: data.effectiveFrom, note: data.note, by: user._id, at: new Date() }],
        },
        history: jsonPush(
          User.history,
          lifecycleEvent(user, {
            type: "stipend_revision",
            date: data.effectiveFrom,
            summary: data.eligible ? `Stipend revised — ${inr(amount)} ${data.period === "monthly" ? "/ month" : "one-time"}` : "Stipend discontinued",
            from: target.internship.stipend?.eligible ? inr(target.internship.stipend.amount) : undefined,
            to: data.eligible ? inr(amount) : undefined,
            note: data.note,
            confidential: true,
          }),
        ),
      })
      .where(eq(User._id, target._id));
    await audit(user, { action: "update", entity: "user", entityId: target._id, ref: target.employeeId, summary: `Revised stipend of ${target.name} (effective ${data.effectiveFrom})` });
    return null;
  }, "Stipend revised");
}

/* ------------------------------------------------------------------ */
/* Access (users.manage)                                               */
/* ------------------------------------------------------------------ */

export async function setLoginAccess(userId: string, enabled: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("users.manage");
    const target = await staffTarget(userId);
    if (target._id === user.id) throw new ActionError("You can't change your own login access.");
    await assertRoleCeiling(user, target);
    if (enabled && (await hasExited(target.status))) throw new ActionError("Change the employment status first — people who have left can't sign in.");
    if (target.accountActive === enabled) return null;
    await db()
      .update(User)
      .set({
        accountActive: enabled,
        history: jsonPush(User.history, lifecycleEvent(user, { type: "access_change", summary: enabled ? "Login access enabled" : "Login access disabled" })),
      })
      .where(eq(User._id, target._id));
    if (!enabled) {
      await revokeUserSessions(target._id, "login access disabled");
      await adviseRotationForUser(target._id, `${target.name}'s login access was disabled after they accessed it`);
    } else await autoCompleteSteps(target._id);
    await audit(user, {
      action: "access",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `${enabled ? "Enabled" : "Disabled"} login access for ${target.name}`,
      changes: [{ field: "accountActive", from: target.accountActive, to: enabled }],
    });
    return null;
  }, "Login access updated");
}

export async function changeRole(userId: string, role: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("users.manage");
    const target = await staffTarget(userId);
    if (target._id === user.id) throw new ActionError("You can't change your own role.");
    // The role key comes from the client: accept only plain slugs (blocks `{ $regex: … }`-style query objects).
    if (typeof role !== "string" || !/^[a-z][a-z0-9_]{1,30}$/.test(role)) throw new ActionError("Choose a valid role.");
    if (role === "super_admin") throw new ActionError("The super admin role can't be assigned.");
    const [next, prev] = await Promise.all([
      db().select({ key: Role.key, name: Role.name, permissions: Role.permissions }).from(Role).where(eq(Role.key, role)).limit(1).then((r) => r[0]),
      db().select({ name: Role.name, permissions: Role.permissions }).from(Role).where(eq(Role.key, target.role)).limit(1).then((r) => r[0]),
    ]);
    if (!next || next.key === "super_admin") throw new ActionError("Choose a valid role.");
    if (!user.isSuperAdmin) {
      // Delegated admins can't hand out — or take away — more power than they hold.
      const own = new Set<string>(user.permissions);
      if (next.permissions.some((p) => !own.has(p))) throw new ActionError("This role has permissions you don't hold, so you can't assign it.");
      if (prev?.permissions.some((p) => !own.has(p))) throw new ActionError(`${target.name}'s current role has permissions you don't hold. Ask the super admin.`);
    }
    if (target.role === next.key) throw new ActionError("This is already the current role.");
    await db()
      .update(User)
      .set({
        role: next.key,
        history: jsonPush(User.history, lifecycleEvent(user, { type: "role_change", summary: `Role changed to ${next.name}`, from: prev?.name ?? target.role, to: next.name })),
      })
      .where(eq(User._id, target._id));
    await revokeUserSessions(target._id, "role changed");
    await audit(user, {
      action: "access",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `Changed role of ${target.name} to ${next.name}`,
      changes: [{ field: "role", from: prev?.name ?? target.role, to: next.name }],
    });
    await notify([target._id], { type: "system", title: "Your role was changed", body: `Your role is now ${next.name}. Please sign in again.`, link: "/profile" }, [user._id]);
    return null;
  }, "Role updated — sessions were signed out");
}

export async function revokeSession(userId: string, sessionId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("users.manage");
    const target = await staffTarget(userId);
    await assertRoleCeiling(user, target);
    if (!isObjectId(sessionId)) throw new ActionError("Session not found.");
    const res = await db()
      .update(Session)
      .set({ revokedAt: new Date(), revokedReason: "revoked by administrator" })
      .where(and(eq(Session._id, sessionId), eq(Session.user, target._id), isNull(Session.revokedAt)))
      .returning({ id: Session._id });
    if (res.length === 0) throw new ActionError("This session is no longer active.");
    await audit(user, { action: "access", entity: "user", entityId: target._id, ref: target.employeeId, summary: `Revoked a session of ${target.name}` });
    return null;
  }, "Session revoked");
}

export async function revokeAllSessions(userId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("users.manage");
    const target = await staffTarget(userId);
    await assertRoleCeiling(user, target);
    await revokeUserSessions(target._id, "revoked by administrator");
    await audit(user, { action: "access", entity: "user", entityId: target._id, ref: target.employeeId, summary: `Signed ${target.name} out of all sessions` });
    return null;
  }, "Signed out everywhere");
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

export async function deletePerson(userId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("staff.delete");
    const target = await staffTarget(userId);
    if (target._id === user.id) throw new ActionError("You can't delete your own record.");
    await assertRoleCeiling(user, target);

    const id = target._id;
    const [attendance, movements, tasks, timesheets, leave, payslips, assets] = await Promise.all([
      db().$count(Attendance, eq(Attendance.user, id)),
      db().$count(Movement, eq(Movement.user, id)),
      db().$count(Task, or(jsonHas(Task.assignees, id), eq(Task.reporter, id))),
      db().$count(TimesheetEntry, eq(TimesheetEntry.user, id)),
      db().$count(LeaveRequest, eq(LeaveRequest.user, id)),
      db().$count(Payslip, eq(Payslip.user, id)),
      db().$count(Asset, eq(Asset.assignedTo, id)),
    ]);
    const checks = [attendance, movements, tasks, timesheets, leave, payslips, assets];
    const labels = ["attendance", "movements", "tasks", "timesheets", "leave", "payslips", "assigned assets"];
    const linked = labels.filter((_, i) => checks[i]);
    if (linked.length > 0) {
      throw new ActionError(`${target.name} has linked records (${linked.join(", ")}). Set the status to Inactive instead of deleting.`);
    }
    const [reports, mentees] = await Promise.all([
      db().$count(User, eq(User.reportingManager, id)),
      db().$count(User, eq(jsonPath(User.internship, "mentor"), id)),
    ]);
    if (reports > 0 || mentees > 0) {
      throw new ActionError(`${target.name} still has ${reports > 0 ? `${reports} direct report${reports === 1 ? "" : "s"}` : ""}${reports > 0 && mentees > 0 ? " and " : ""}${mentees > 0 ? `${mentees} mentee${mentees === 1 ? "" : "s"}` : ""}. Reassign them first, or set the status to Inactive.`);
    }

    // One atomic round trip: the person's data goes with the record (or nothing changes).
    await db().batch([
      db()
        .update(StoredFile)
        .set({ deletedAt: new Date(), deletedBy: user._id })
        .where(and(inList(StoredFile.entityType, ["user", "avatar"]), eq(StoredFile.entityId, id), isNull(StoredFile.deletedAt))),
      db().delete(Review).where(eq(Review.user, id)),
      db().delete(Session).where(eq(Session.user, id)),
      db().delete(Notification).where(eq(Notification.user, id)),
      // `$pull` the person from every learning resource's assignees and completions.
      db()
        .update(LearningResource)
        .set({
          assignedTo: sql`(select json_group_array(value) from json_each(${LearningResource.assignedTo}) where value != ${id})`,
          completions: sql`(select json_group_array(json(value)) from json_each(${LearningResource.completions}) where json_extract(value, '$.user') != ${id})`,
        })
        .where(
          or(
            jsonHas(LearningResource.assignedTo, id),
            sql`exists (select 1 from json_each(${LearningResource.completions}) where json_extract(value, '$.user') = ${id})`,
          ),
        ),
      db().update(Department).set({ head: null }).where(eq(Department.head, id)),
      db().delete(User).where(eq(User._id, id)),
    ]);
    await audit(user, { action: "delete", entity: "user", entityId: id, ref: target.employeeId, summary: `Deleted ${target.name} (${target.employeeId})` });
    return null;
  }, "Person deleted");
}

/* ------------------------------------------------------------------ */
/* Photo                                                               */
/* ------------------------------------------------------------------ */

/** Sets the profile photo from an already-uploaded public avatar file (self or staff.edit). */
export async function setPhoto(userId: string, fileId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    if (!isObjectId(userId) || !isObjectId(fileId)) throw new ActionError("Photo not found.");
    const self = user.id === userId;
    if (!self && !can(user, "staff.edit")) throw new ActionError("You can't change this photo.");
    const [target] = await db().select({ _id: User._id, name: User.name, employeeId: User.employeeId, personType: User.personType }).from(User).where(eq(User._id, userId)).limit(1);
    if (!target || (target.personType === "admin" && !self)) throw new ActionError("Person not found.");
    const [file] = await db().select().from(StoredFile).where(eq(StoredFile._id, fileId)).limit(1);
    if (!file || file.deletedAt || file.entityType !== "avatar" || !file.isPublic || !file.url || file.uploadedBy !== user.id) {
      throw new ActionError("Uploaded photo not found. Please upload it again.");
    }
    await db().update(User).set({ photo: file.url }).where(eq(User._id, target._id));
    await audit(user, { action: "update", entity: "user", entityId: target._id, ref: target.employeeId, summary: `Changed profile photo of ${target.name}` });
    return { url: file.url };
  }, "Photo updated");
}
