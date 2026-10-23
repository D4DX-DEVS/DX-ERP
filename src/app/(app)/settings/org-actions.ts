"use server";

import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { escapeRegex } from "@/lib/format";
import { Asset, Department, Designation, Holiday, LeaveBalance, LeaveRequest, LeaveType, User } from "@/lib/models";
import { fmtDate } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";

const PERSON_TYPES = ["employee", "trainee", "intern"] as const;

function fieldError(field: string, message: string): never {
  throw new ActionError(message, { [field]: message });
}

function nameClash(name: string, id?: string) {
  return { name: new RegExp(`^${escapeRegex(name)}$`, "i"), ...(id ? { _id: { $ne: id } } : {}) };
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
    if (await Department.exists(nameClash(data.name, data.id))) fieldError("name", "A department with this name already exists");
    if (data.head && !(await User.exists({ _id: data.head, personType: { $in: ["employee", "trainee", "intern"] } }))) fieldError("head", "Choose a person from the staff list");

    const fields = { name: data.name, code: data.code, head: data.head, description: data.description, active: data.active };
    if (!data.id) {
      const doc = await Department.create(fields);
      await audit(user, { action: "config", entity: "department", entityId: doc._id, ref: doc.name, summary: `Created department ${doc.name}` });
      return { id: doc._id.toString() };
    }
    const before = await Department.findById(data.id).lean();
    if (!before) throw new ActionError("Department not found");
    await Department.updateOne({ _id: data.id }, unsetOptional(fields));
    const changes = diff(
      { name: before.name, code: before.code, head: before.head?.toString(), description: before.description, active: before.active },
      { name: data.name, code: data.code, head: data.head, description: data.description, active: data.active },
      ["name", "code", "head", "description", "active"],
    );
    if (changes.length) await audit(user, { action: "config", entity: "department", entityId: data.id, ref: data.name, summary: `Updated department ${data.name} · ${changes.map((c) => c.field).join(", ")}`, changes });
    return { id: data.id };
  }, "Department saved");
}

/** `$set` for present optional values and `$unset` for cleared ones, so edits can clear fields. */
function unsetOptional(fields: Record<string, unknown>): { $set?: Record<string, unknown>; $unset?: Record<string, ""> } {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === "") unset[k] = "";
    else set[k] = v;
  }
  return { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) };
}

export async function deleteDepartment(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Department not found");
    const dept = await Department.findById(id).lean();
    if (!dept) throw new ActionError("Department not found");
    const [people, designations, assets] = await Promise.all([
      User.countDocuments({ department: id }),
      Designation.countDocuments({ department: id }),
      Asset.countDocuments({ department: id }),
    ]);
    if (people > 0) throw new ActionError(`${people} ${people === 1 ? "person is" : "people are"} assigned to ${dept.name}. Reassign them first, or mark the department inactive.`);
    if (designations > 0) throw new ActionError(`${designations} designation(s) belong to ${dept.name}. Move or remove them first.`);
    if (assets > 0) throw new ActionError(`${assets} asset(s) are assigned to ${dept.name}. Transfer them first, or mark the department inactive.`);
    await Department.deleteOne({ _id: id });
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
    if (await Designation.exists(nameClash(data.name, data.id))) fieldError("name", "A designation with this name already exists");
    if (data.department && !(await Department.exists({ _id: data.department }))) fieldError("department", "Department not found");
    const level = data.level === undefined ? undefined : Math.round(data.level);

    if (!data.id) {
      const doc = await Designation.create({ name: data.name, department: data.department, level, active: data.active });
      await audit(user, { action: "config", entity: "designation", entityId: doc._id, ref: doc.name, summary: `Created designation ${doc.name}` });
      return { id: doc._id.toString() };
    }
    const before = await Designation.findById(data.id).lean();
    if (!before) throw new ActionError("Designation not found");
    await Designation.updateOne({ _id: data.id }, unsetOptional({ name: data.name, department: data.department, level, active: data.active }));
    const changes = diff(
      { name: before.name, department: before.department?.toString(), level: before.level, active: before.active },
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
    const item = await Designation.findById(id).lean();
    if (!item) throw new ActionError("Designation not found");
    const people = await User.countDocuments({ designation: id });
    if (people > 0) throw new ActionError(`${people} ${people === 1 ? "person holds" : "people hold"} the designation ${item.name}. Reassign them first, or mark it inactive.`);
    await Designation.deleteOne({ _id: id });
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
    const clash = await Holiday.findOne({ date: data.date, ...(data.id ? { _id: { $ne: data.id } } : {}) }, { name: 1 }).lean();
    if (clash) fieldError("date", `${fmtDate(data.date)} is already a holiday (${clash.name})`);

    if (!data.id) {
      const doc = await Holiday.create({ date: data.date, name: data.name, optional: data.optional });
      await audit(user, { action: "config", entity: "holiday", entityId: doc._id, ref: data.date, summary: `Added ${data.optional ? "optional " : ""}holiday ${data.name} on ${fmtDate(data.date)}` });
      return { id: doc._id.toString() };
    }
    const before = await Holiday.findById(data.id).lean();
    if (!before) throw new ActionError("Holiday not found");
    await Holiday.updateOne({ _id: data.id }, { $set: { date: data.date, name: data.name, optional: data.optional } });
    const changes = diff({ date: before.date, name: before.name, optional: before.optional }, { date: data.date, name: data.name, optional: data.optional }, ["date", "name", "optional"]);
    if (changes.length) await audit(user, { action: "config", entity: "holiday", entityId: data.id, ref: data.date, summary: `Updated holiday ${data.name} · ${changes.map((c) => c.field).join(", ")}`, changes });
    return { id: data.id };
  }, "Holiday saved");
}

export async function deleteHoliday(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    if (!isObjectId(id)) throw new ActionError("Holiday not found");
    const doc = await Holiday.findByIdAndDelete(id).lean();
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
    const existing = new Set((await Holiday.find({ date: { $in: unique.map((p) => p.date) } }, { date: 1 }).lean()).map((h) => h.date));
    const fresh = unique.filter((p) => !existing.has(p.date));
    if (fresh.length > 0) await Holiday.insertMany(fresh, { ordered: false });
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
    if (await LeaveType.exists({ code: data.code, ...(data.id ? { _id: { $ne: data.id } } : {}) })) fieldError("code", "Another leave type already uses this code");
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
      const last = await LeaveType.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
      const doc = await LeaveType.create({ ...values, order: data.order ?? (last?.order ?? 0) + 1 });
      await audit(user, { action: "config", entity: "leave_type", entityId: doc._id, ref: doc.code, summary: `Created leave type ${doc.name} (${doc.code}) · ${doc.annualQuota} days/year` });
      return { id: doc._id.toString() };
    }
    const before = await LeaveType.findById(data.id).lean();
    if (!before) throw new ActionError("Leave type not found");
    const order = data.order ?? before.order;
    await LeaveType.updateOne({ _id: data.id }, unsetOptional({ ...values, order }));
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
    const type = await LeaveType.findById(id).lean();
    if (!type) throw new ActionError("Leave type not found");
    const [requests, history] = await Promise.all([
      LeaveRequest.countDocuments({ leaveType: id }),
      LeaveBalance.countDocuments({ leaveType: id, $or: [{ carriedForward: { $ne: 0 } }, { adjustment: { $ne: 0 } }, { quotaOverride: { $exists: true } }, { "notes.0": { $exists: true } }] }),
    ]);
    if (requests > 0 || history > 0) {
      if (type.active) await LeaveType.updateOne({ _id: id }, { $set: { active: false } });
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
    await LeaveBalance.deleteMany({ leaveType: id });
    await LeaveType.deleteOne({ _id: id });
    await audit(user, { action: "config", entity: "leave_type", entityId: id, ref: type.code, summary: `Deleted leave type ${type.name} (${type.code})` });
    return { deactivated: false };
  });
}
