"use server";

import { and, desc, eq, gt, isNotNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { db } from "@/lib/db";
import { Asset, Department, Designation, Holiday, LeaveBalance, LeaveRequest, LeaveType, User } from "@/lib/models";
import { eqIgnoreCase, inList, insertChunked, jsonLength } from "@/lib/sql";
import { fmtDate } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";

const PERSON_TYPES = ["employee", "trainee", "intern"] as const;

function fieldError(field: string, message: string): never {
  throw new ActionError(message, { [field]: message });
}

/** Another department / designation already uses this name (case-insensitive, exact). */
async function departmentNameTaken(name: string, id?: string): Promise<boolean> {
  const [hit] = await db()
    .select({ id: Department._id })
    .from(Department)
    .where(and(eqIgnoreCase(Department.name, name), id ? ne(Department._id, id) : undefined))
    .limit(1);
  return Boolean(hit);
}

async function designationNameTaken(name: string, id?: string): Promise<boolean> {
  const [hit] = await db()
    .select({ id: Designation._id })
    .from(Designation)
    .where(and(eqIgnoreCase(Designation.name, name), id ? ne(Designation._id, id) : undefined))
    .limit(1);
  return Boolean(hit);
}

/* ───────────────────────────── Departments ───────────────────────────── */

const departmentSchema = z.object({
  id: zs.optId(),
  name: zs.text("Name", 80),
  code: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v), z.string().regex(/^[A-Z0-9&-]{1,10}$/, "Up to 10 letters or digits").optional()),
  head: zs.optId(),
  description: zs.optText(300),
  active: zs.bool(),
});

export async function saveDepartment(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(departmentSchema, input);
    if (await departmentNameTaken(data.name, data.id)) fieldError("name", "A department with this name already exists");
    if (data.head) {
      const [head] = await db()
        .select({ id: User._id })
        .from(User)
        .where(and(eq(User._id, data.head), inList(User.personType, ["employee", "trainee", "intern"])))
        .limit(1);
      if (!head) fieldError("head", "Choose a person from the staff list");
    }

    const fields = { name: data.name, code: data.code, head: data.head, description: data.description, active: data.active };
    if (!data.id) {
      const [doc] = await db().insert(Department).values(fields).returning({ _id: Department._id, name: Department.name });
      await audit(user, { action: "config", entity: "department", entityId: doc._id, ref: doc.name, summary: `Created department ${doc.name}` });
      return { id: doc._id };
    }
    const [before] = await db().select().from(Department).where(eq(Department._id, data.id)).limit(1);
    if (!before) throw new ActionError("Department not found");
    // Cleared optional fields are set to null, so edits can clear them.
    await db()
      .update(Department)
      .set({ name: data.name, code: data.code || null, head: data.head || null, description: data.description || null, active: data.active })
      .where(eq(Department._id, data.id));
    const changes = diff(
      { name: before.name, code: before.code, head: before.head, description: before.description, active: before.active },
      { name: data.name, code: data.code, head: data.head, description: data.description, active: data.active },
      ["name", "code", "head", "description", "active"],
    );
    if (changes.length) await audit(user, { action: "config", entity: "department", entityId: data.id, ref: data.name, summary: `Updated department ${data.name} · ${changes.map((c) => c.field).join(", ")}`, changes });
    return { id: data.id };
  }, "Department saved");
}

export async function deleteDepartment(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Department not found");
    const [dept] = await db().select().from(Department).where(eq(Department._id, id)).limit(1);
    if (!dept) throw new ActionError("Department not found");
    const [people, designations, assets] = await Promise.all([
      db().$count(User, eq(User.department, id)),
      db().$count(Designation, eq(Designation.department, id)),
      db().$count(Asset, eq(Asset.department, id)),
    ]);
    if (people > 0) throw new ActionError(`${people} ${people === 1 ? "person is" : "people are"} assigned to ${dept.name}. Reassign them first, or mark the department inactive.`);
    if (designations > 0) throw new ActionError(`${designations} designation(s) belong to ${dept.name}. Move or remove them first.`);
    if (assets > 0) throw new ActionError(`${assets} asset(s) are assigned to ${dept.name}. Transfer them first, or mark the department inactive.`);
    await db().delete(Department).where(eq(Department._id, id));
    await audit(user, { action: "config", entity: "department", entityId: id, ref: dept.name, summary: `Deleted department ${dept.name}` });
    return null;
  }, "Department deleted");
}

/* ───────────────────────────── Designations ───────────────────────────── */

const designationSchema = z.object({
  id: zs.optId(),
  name: zs.text("Name", 80),
  department: zs.optId(),
  level: zs.optNum({ min: 1, max: 99 }),
  active: zs.bool(),
});

export async function saveDesignation(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(designationSchema, input);
    if (await designationNameTaken(data.name, data.id)) fieldError("name", "A designation with this name already exists");
    if (data.department) {
      const [dept] = await db().select({ id: Department._id }).from(Department).where(eq(Department._id, data.department)).limit(1);
      if (!dept) fieldError("department", "Department not found");
    }
    const level = data.level === undefined ? undefined : Math.round(data.level);

    if (!data.id) {
      const [doc] = await db()
        .insert(Designation)
        .values({ name: data.name, department: data.department, level, active: data.active })
        .returning({ _id: Designation._id, name: Designation.name });
      await audit(user, { action: "config", entity: "designation", entityId: doc._id, ref: doc.name, summary: `Created designation ${doc.name}` });
      return { id: doc._id };
    }
    const [before] = await db().select().from(Designation).where(eq(Designation._id, data.id)).limit(1);
    if (!before) throw new ActionError("Designation not found");
    await db()
      .update(Designation)
      .set({ name: data.name, department: data.department || null, level: level ?? null, active: data.active })
      .where(eq(Designation._id, data.id));
    const changes = diff(
      { name: before.name, department: before.department, level: before.level, active: before.active },
      { name: data.name, department: data.department, level, active: data.active },
      ["name", "department", "level", "active"],
    );
    if (changes.length) await audit(user, { action: "config", entity: "designation", entityId: data.id, ref: data.name, summary: `Updated designation ${data.name} · ${changes.map((c) => c.field).join(", ")}`, changes });
    return { id: data.id };
  }, "Designation saved");
}

export async function deleteDesignation(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Designation not found");
    const [item] = await db().select().from(Designation).where(eq(Designation._id, id)).limit(1);
    if (!item) throw new ActionError("Designation not found");
    const people = await db().$count(User, eq(User.designation, id));
    if (people > 0) throw new ActionError(`${people} ${people === 1 ? "person holds" : "people hold"} the designation ${item.name}. Reassign them first, or mark it inactive.`);
    await db().delete(Designation).where(eq(Designation._id, id));
    await audit(user, { action: "config", entity: "designation", entityId: id, ref: item.name, summary: `Deleted designation ${item.name}` });
    return null;
  }, "Designation deleted");
}

/* ───────────────────────────── Holidays ───────────────────────────── */

function isRealDate(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

const holidaySchema = z.object({ id: zs.optId(), date: zs.date("Date"), name: zs.text("Name", 100), optional: zs.bool() });

export async function saveHoliday(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(holidaySchema, input);
    if (!isRealDate(data.date)) fieldError("date", "Enter a valid date");
    const [clash] = await db()
      .select({ name: Holiday.name })
      .from(Holiday)
      .where(and(eq(Holiday.date, data.date), data.id ? ne(Holiday._id, data.id) : undefined))
      .limit(1);
    if (clash) fieldError("date", `${fmtDate(data.date)} is already a holiday (${clash.name})`);

    if (!data.id) {
      const [doc] = await db().insert(Holiday).values({ date: data.date, name: data.name, optional: data.optional }).returning({ _id: Holiday._id });
      await audit(user, { action: "config", entity: "holiday", entityId: doc._id, ref: data.date, summary: `Added ${data.optional ? "optional " : ""}holiday ${data.name} on ${fmtDate(data.date)}` });
      return { id: doc._id };
    }
    const [before] = await db().select().from(Holiday).where(eq(Holiday._id, data.id)).limit(1);
    if (!before) throw new ActionError("Holiday not found");
    await db().update(Holiday).set({ date: data.date, name: data.name, optional: data.optional }).where(eq(Holiday._id, data.id));
    const changes = diff({ date: before.date, name: before.name, optional: before.optional }, { date: data.date, name: data.name, optional: data.optional }, ["date", "name", "optional"]);
    if (changes.length) await audit(user, { action: "config", entity: "holiday", entityId: data.id, ref: data.date, summary: `Updated holiday ${data.name} · ${changes.map((c) => c.field).join(", ")}`, changes });
    return { id: data.id };
  }, "Holiday saved");
}

export async function deleteHoliday(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Holiday not found");
    const [doc] = await db().delete(Holiday).where(eq(Holiday._id, id)).returning({ date: Holiday.date, name: Holiday.name });
    if (!doc) throw new ActionError("Holiday not found");
    await audit(user, { action: "config", entity: "holiday", entityId: id, ref: doc.date, summary: `Removed holiday ${doc.name} (${fmtDate(doc.date)})` });
    return null;
  }, "Holiday removed");
}

/** Bulk add from pasted lines: `yyyy-mm-dd, Name` (optionally `, optional`). Existing dates are skipped. */
export async function bulkAddHolidays(input: Record<string, unknown>): Promise<ActionResult<{ added: number; skipped: string[] }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const { text } = parse(z.object({ text: zs.text("Holiday list", 20_000) }), input);
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 200) throw new ActionError("Add at most 200 holidays at a time.");

    const parsed: { date: string; name: string; optional: boolean }[] = [];
    const bad: string[] = [];
    lines.forEach((line, i) => {
      const m = line.match(/^(\d{4}-\d{2}-\d{2})\s*[,;\t]\s*(.+?)(?:\s*[,;\t]\s*(optional))?$/i);
      if (!m || !isRealDate(m[1]) || m[2].length > 100) bad.push(`line ${i + 1}`);
      else parsed.push({ date: m[1], name: m[2].trim(), optional: Boolean(m[3]) });
    });
    if (bad.length > 0) throw new ActionError(`Couldn't read ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}. Use "yyyy-mm-dd, Holiday name".`, { text: "Check the format of the highlighted lines" });

    const unique = [...new Map(parsed.map((p) => [p.date, p])).values()];
    const existing = new Set((await db().select({ date: Holiday.date }).from(Holiday).where(inList(Holiday.date, unique.map((p) => p.date)))).map((h) => h.date));
    const fresh = unique.filter((p) => !existing.has(p.date));
    if (fresh.length > 0) await insertChunked(db(), Holiday, fresh);
    const skipped = unique.filter((p) => existing.has(p.date)).map((p) => p.date);
    if (fresh.length > 0) {
      await audit(user, {
        action: "config",
        entity: "holiday",
        ref: `${fresh.length} added`,
        summary: `Bulk-added ${fresh.length} holiday(s): ${fresh.slice(0, 4).map((p) => `${p.name} (${fmtDate(p.date)})`).join(", ")}${fresh.length > 4 ? ", …" : ""}`,
      });
    }
    return { added: fresh.length, skipped };
  });
}

/* ───────────────────────────── Leave types ───────────────────────────── */

const leaveTypeSchema = z.object({
  id: zs.optId(),
  name: zs.text("Name", 60),
  code: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.string({ error: "Code is required" }).regex(/^[A-Z0-9_]{1,8}$/, "Up to 8 letters, digits or _")),
  color: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : "#284CC7"), z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour")),
  annualQuota: zs.num("Annual quota", { min: 0, max: 366 }),
  accrual: z.enum(["upfront", "monthly"], { error: "Choose how leave accrues" }),
  carryForward: zs.bool(),
  maxCarryForward: zs.optNum({ min: 0, max: 366 }),
  paid: zs.bool(),
  allowHalfDay: zs.bool(),
  requiresHrApproval: zs.bool(),
  requiresAttachmentAfterDays: zs.optNum({ min: 0, max: 60 }),
  applicableTo: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.enum(PERSON_TYPES)).min(1, "Select who this applies to")),
  active: zs.bool(),
  order: zs.optNum({ min: 0, max: 999 }),
});

const LEAVE_FIELDS = ["name", "code", "annualQuota", "accrual", "carryForward", "maxCarryForward", "paid", "allowHalfDay", "requiresHrApproval", "requiresAttachmentAfterDays", "applicableTo", "active", "order", "color"] as const;

export async function saveLeaveType(input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(leaveTypeSchema, input);
    const [codeClash] = await db()
      .select({ id: LeaveType._id })
      .from(LeaveType)
      .where(and(eq(LeaveType.code, data.code), data.id ? ne(LeaveType._id, data.id) : undefined))
      .limit(1);
    if (codeClash) fieldError("code", "Another leave type already uses this code");
    const carry = data.carryForward;
    const values = {
      name: data.name,
      code: data.code,
      color: data.color.toUpperCase(),
      annualQuota: data.annualQuota,
      accrual: data.accrual,
      carryForward: carry,
      maxCarryForward: carry ? (data.maxCarryForward ?? 0) : 0,
      paid: data.paid,
      allowHalfDay: data.allowHalfDay,
      requiresHrApproval: data.requiresHrApproval,
      requiresAttachmentAfterDays: data.requiresAttachmentAfterDays,
      applicableTo: data.applicableTo,
      active: data.active,
    };

    if (!data.id) {
      const [last] = await db().select({ order: LeaveType.order }).from(LeaveType).orderBy(desc(LeaveType.order)).limit(1);
      const [doc] = await db()
        .insert(LeaveType)
        .values({ ...values, order: data.order ?? (last?.order ?? 0) + 1 })
        .returning({ _id: LeaveType._id, name: LeaveType.name, code: LeaveType.code, annualQuota: LeaveType.annualQuota });
      await audit(user, { action: "config", entity: "leave_type", entityId: doc._id, ref: doc.code, summary: `Created leave type ${doc.name} (${doc.code}) · ${doc.annualQuota} days/year` });
      return { id: doc._id };
    }
    const [before] = await db().select().from(LeaveType).where(eq(LeaveType._id, data.id)).limit(1);
    if (!before) throw new ActionError("Leave type not found");
    const order = data.order ?? before.order;
    await db()
      .update(LeaveType)
      .set({ ...values, requiresAttachmentAfterDays: values.requiresAttachmentAfterDays ?? null, order })
      .where(eq(LeaveType._id, data.id));
    const changes = diff(
      before as unknown as Record<string, unknown>,
      { ...values, order } as Record<string, unknown>,
      [...LEAVE_FIELDS],
    );
    if (changes.length) await audit(user, { action: "config", entity: "leave_type", entityId: data.id, ref: data.code, summary: `Updated leave type ${data.name} · ${changes.map((c) => c.field).join(", ")}`, changes });
    return { id: data.id };
  }, "Leave type saved");
}

/** Deletes a leave type, or deactivates it when requests or balance history refer to it. */
export async function deleteLeaveType(id: string): Promise<ActionResult<{ deactivated: boolean }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Leave type not found");
    const [type] = await db().select().from(LeaveType).where(eq(LeaveType._id, id)).limit(1);
    if (!type) throw new ActionError("Leave type not found");
    const [requests, history] = await Promise.all([
      db().$count(LeaveRequest, eq(LeaveRequest.leaveType, id)),
      db().$count(
        LeaveBalance,
        and(
          eq(LeaveBalance.leaveType, id),
          or(ne(LeaveBalance.carriedForward, 0), ne(LeaveBalance.adjustment, 0), isNotNull(LeaveBalance.quotaOverride), gt(jsonLength(LeaveBalance.notes), 0)),
        ),
      ),
    ]);
    if (requests > 0 || history > 0) {
      if (type.active) await db().update(LeaveType).set({ active: false }).where(eq(LeaveType._id, id));
      await audit(user, {
        action: "config",
        entity: "leave_type",
        entityId: id,
        ref: type.code,
        summary: `Deactivated leave type ${type.name} instead of deleting (${requests} request(s), ${history} adjusted balance(s) exist)`,
        changes: [{ field: "active", from: "true", to: "false" }],
      });
      return { deactivated: true };
    }
    await db().batch([db().delete(LeaveBalance).where(eq(LeaveBalance.leaveType, id)), db().delete(LeaveType).where(eq(LeaveType._id, id))]);
    await audit(user, { action: "config", entity: "leave_type", entityId: id, ref: type.code, summary: `Deleted leave type ${type.name} (${type.code})` });
    return { deactivated: false };
  });
}
