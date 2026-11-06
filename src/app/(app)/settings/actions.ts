"use server";

import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/auth/session";
import { NOTIFICATION_EVENTS, taxLabel, type AppSettings, type PayrollComponent } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { AttendanceKiosk, Movement, StoredFile } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { inList } from "@/lib/sql";
import { hmToMinutes } from "@/lib/time";
import { zs } from "@/lib/validation";
import { EMPLOYMENT_CATEGORIES, PIPELINE_CATEGORIES, PROJECT_CATEGORIES, TASK_CATEGORIES, TONES } from "./constants";
import { assertStatusesRemovable, assertUniqueLabels, assignKeys, saveConfig, type StatusKind } from "./helpers";

type Saved = ActionResult<{ changed: number }>;

const PERSON_TYPES = ["employee", "trainee", "intern"] as const;
const personTypes = z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.enum(PERSON_TYPES)));
const optUpper = (re: RegExp, message: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v), z.string().regex(re, message).optional());
const rows = <T extends z.ZodType>(item: T, max = 100) =>
  z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(item).max(max, `At most ${max} items`));

function fieldError(field: string, message: string): never {
  throw new ActionError(message, { [field]: message });
}

/* ───────────────────────────── Company ───────────────────────────── */

const companySchema = z.object({
  name: zs.text("Company name", 120),
  legalName: zs.text("Legal name", 160),
  address: zs.optText(500),
  email: zs.optEmail(),
  phone: zs.optText(40),
  website: z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v), z.url({ error: "Enter a full web address, e.g. https://d4dx.co" }).max(200).optional()),
  logoFile: zs.ids(),
  resetLogo: zs.bool(),
});

export async function saveCompany(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(companySchema, input);
    const before = (await getSettings()).company;

    let logo = before.logo;
    if (data.logoFile.length > 0) {
      const [file] = await db()
        .select({ url: StoredFile.url })
        .from(StoredFile)
        .where(and(eq(StoredFile._id, data.logoFile[data.logoFile.length - 1]), eq(StoredFile.entityType, "company"), eq(StoredFile.isPublic, true), isNull(StoredFile.deletedAt)))
        .limit(1);
      if (!file?.url) fieldError("logoFile", "The uploaded logo could not be found. Upload it again.");
      logo = file.url;
    }
    const next: AppSettings["company"] = {
      name: data.name,
      legalName: data.legalName,
      address: data.address ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
      website: data.website ?? "",
      // Edited under GST & bank details.
      gstin: before.gstin,
      pan: before.pan,
    };
    // Omitting the key falls back to the default D4DX logo.
    if (logo && !data.resetLogo) next.logo = logo;
    return saveConfig(user, "company", "Company profile", next);
  }, "Company profile saved");
}

/* ───────────────────────────── GST & bank details ───────────────────────────── */

const gstBankSchema = z.object({
  gstin: optUpper(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN"),
  pan: optUpper(/^[A-Z]{5}\d{4}[A-Z]$/, "Enter a valid 10-character PAN"),
  accountName: zs.optText(160),
  bankName: zs.optText(120),
  branch: zs.optText(120),
  accountNumber: optUpper(/^[0-9A-Z]{6,20}$/, "Enter the account number (6–20 letters or digits, no spaces)"),
  ifsc: optUpper(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid 11-character IFSC, e.g. SBIN0001234"),
  upiId: z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v), z.string().regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, "Enter a valid UPI ID, e.g. d4dx@okaxis").optional()),
  bankDetails: zs.optText(1000),
});

export async function saveGstAndBank(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(gstBankSchema, input);
    const before = await getSettings();
    const company = await saveConfig(user, "company", "GST details", { ...before.company, gstin: data.gstin ?? "", pan: data.pan ?? "" });
    const bank = await saveConfig(user, "bank", "Bank details", {
      accountName: data.accountName ?? "",
      bankName: data.bankName ?? "",
      branch: data.branch ?? "",
      accountNumber: data.accountNumber ?? "",
      ifsc: data.ifsc ?? "",
      upiId: data.upiId ?? "",
    });
    const note = await saveConfig(user, "documents", "Payment details", { ...before.documents, bankDetails: data.bankDetails ?? "" });
    return { changed: company.changed + bank.changed + note.changed };
  }, "GST and bank details saved");
}

/* ───────────────────────────── Attendance ───────────────────────────── */

const attendanceSchema = z.object({
  workingDays: z.preprocess(
    (v) => (Array.isArray(v) ? v : v ? [v] : []).map(Number),
    z.array(z.number().int().min(0).max(6)).min(1, "Select at least one working day"),
  ),
  saturdaysOff: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []).map(Number), z.array(z.number().int().min(1).max(5))),
  officeStart: zs.time("Office start"),
  officeEnd: zs.time("Office end"),
  graceMinutes: zs.num("Grace period", { min: 0, max: 240 }),
  earlyLeaveGraceMinutes: zs.num("Early-leave grace", { min: 0, max: 240 }),
  fullDayMinutes: zs.num("Full day", { min: 30, max: 1440 }),
  halfDayMinutes: zs.num("Half day", { min: 15, max: 1440 }),
  missingCheckoutAfter: zs.time("Missing check-out alert"),
  officialMovementCountsAsWork: zs.bool(),
  personalMovementDeducted: zs.bool(),
  allowSelfCheckIn: zs.bool(),
  qrCheckIn: zs.bool(),
  trackingStartDate: zs.optDate(),
});

export async function saveAttendance(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(attendanceSchema, input);
    if (hmToMinutes(data.officeEnd) <= hmToMinutes(data.officeStart)) fieldError("officeEnd", "Office end must be after office start");
    if (data.halfDayMinutes >= data.fullDayMinutes) fieldError("halfDayMinutes", "Half day must be shorter than a full day");
    if (hmToMinutes(data.missingCheckoutAfter) <= hmToMinutes(data.officeEnd)) fieldError("missingCheckoutAfter", "Must be later than the office end time");
    if (data.qrCheckIn) {
      const [screen] = await db().select({ id: AttendanceKiosk._id }).from(AttendanceKiosk).where(isNotNull(AttendanceKiosk.deviceId)).limit(1);
      if (!screen) fieldError("qrCheckIn", "Set up a QR screen first: add one under QR check-in screens and open its link on the office computer.");
    }
    const next: AppSettings["attendance"] = { ...data, trackingStartDate: data.trackingStartDate ?? "", workingDays: [...new Set(data.workingDays)].sort((a, b) => a - b), saturdaysOff: [...new Set(data.saturdaysOff)].sort((a, b) => a - b) };
    return saveConfig(user, "attendance", "Working days & attendance rules", next);
  }, "Attendance rules saved");
}

/* ───────────────────────────── Leave policy settings ───────────────────────────── */

const leaveSettingsSchema = z.object({
  yearStartMonth: zs.num("Leave year start", { min: 1, max: 12 }),
  allowNegativeBalance: zs.bool(),
  countWeekendsInLeave: zs.bool(),
  compOffClaimDays: zs.num("Comp-off claim window", { min: 1, max: 365 }),
});

export async function saveLeaveSettings(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(leaveSettingsSchema, input);
    return saveConfig(user, "leave", "Leave policy", { ...data, yearStartMonth: Math.round(data.yearStartMonth), compOffClaimDays: Math.round(data.compOffClaimDays) });
  }, "Leave policy saved");
}

/* ───────────────────────────── Payroll ───────────────────────────── */

const payrollSchema = z.object({
  payDay: zs.num("Pay day", { min: 1, max: 28 }),
  lopBasis: z.enum(["working_days", "calendar_days"], { error: "Choose a loss-of-pay basis" }),
  components: rows(
    z.object({
      key: zs.optText(80),
      name: zs.text("Component name", 80),
      type: z.enum(["earning", "deduction"]),
      calc: z.enum(["fixed", "percent_basic"]),
      value: zs.num("Value", { min: 0 }),
      cap: zs.optNum({ min: 0 }),
      appliesTo: personTypes,
      active: zs.bool(),
    }),
    60,
  ),
});

export async function savePayroll(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(payrollSchema, input);
    assertUniqueLabels(data.components.map((c) => c.name), "payroll component");
    for (const c of data.components) {
      if (c.calc === "percent_basic" && c.value > 100) throw new ActionError(`"${c.name}": a percentage of basic can't exceed 100.`);
    }
    const before = (await getSettings()).payroll;
    const keyed = assignKeys(data.components, before.components, (c) => c.name);
    const components: PayrollComponent[] = keyed.map((c) => ({
      key: c.key,
      name: c.name,
      type: c.type,
      calc: c.calc,
      value: c.value,
      ...(c.calc === "percent_basic" && c.cap ? { cap: c.cap } : {}),
      appliesTo: c.appliesTo,
      active: c.active,
    }));
    return saveConfig(user, "payroll", "Payroll & stipend components", { components, payDay: Math.round(data.payDay), lopBasis: data.lopBasis });
  }, "Payroll settings saved");
}

/* ───────────────────────────── Movement ───────────────────────────── */

const movementSchema = z.object({
  overdueGraceMinutes: zs.num("Overdue grace", { min: 0, max: 240 }),
  requireExpectedReturn: zs.bool(),
  alternativeEntryMaxDays: zs.num("Alternative-entry limit", { min: 0, max: 90 }),
  categories: rows(
    z.object({
      key: zs.optText(80),
      label: zs.text("Category name", 60),
      official: zs.bool(),
      requiresApproval: zs.bool(),
      active: zs.bool(),
    }),
    40,
  ),
});

export async function saveMovement(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(movementSchema, input);
    assertUniqueLabels(data.categories.map((c) => c.label), "movement category");
    if (!data.categories.some((c) => c.active)) throw new ActionError("At least one movement category must stay active.");

    const before = (await getSettings()).movement;
    const categories = assignKeys(data.categories, before.categories, (c) => c.label);
    const nextKeys = new Set(categories.map((c) => c.key));
    const removed = before.categories.filter((c) => !nextKeys.has(c.key));
    if (removed.length > 0) {
      const used = await db()
        .select({ key: Movement.category, n: count() })
        .from(Movement)
        .where(inList(Movement.category, removed.map((r) => r.key)))
        .groupBy(Movement.category);
      if (used.length > 0) {
        const names = used.map((u) => `"${before.categories.find((c) => c.key === u.key)?.label ?? u.key}" (${u.n} movements)`).join(", ");
        throw new ActionError(`Can't remove ${names} because movements use it. Switch it to inactive instead.`);
      }
    }
    return saveConfig(user, "movement", "Movement categories & approval rules", {
      categories,
      overdueGraceMinutes: Math.round(data.overdueGraceMinutes),
      requireExpectedReturn: data.requireExpectedReturn,
      alternativeEntryMaxDays: Math.round(data.alternativeEntryMaxDays),
    });
  }, "Movement rules saved");
}

/* ───────────────────────────── Statuses & pipeline ───────────────────────────── */

const tone = z.enum(TONES as [string, ...string[]]);
const statusBase = { key: zs.optText(80), label: zs.text("Label", 60), tone };

function statusItems<C extends readonly [string, ...string[]]>(categories: C, extra: z.ZodRawShape = {}) {
  return z.object({ items: rows(z.object({ ...statusBase, category: z.enum(categories as unknown as [string, ...string[]]), ...extra }), 40) });
}

async function saveStatusList<K extends "projectStatuses" | "taskStatuses" | "pipelineStages" | "employmentStatuses">(
  section: K,
  kind: StatusKind,
  label: string,
  items: { key?: string; label: string }[],
  required: { category: string; message: string }[],
): Promise<{ changed: number }> {
  const user = await actionPermission("settings.manage");
  if (items.length === 0) throw new ActionError(`Keep at least one ${label.toLowerCase()} entry.`);
  assertUniqueLabels(items.map((i) => i.label), "entry");
  const before = (await getSettings())[section] as { key: string; label: string }[];
  const keyed = assignKeys(items, before, (i) => i.label);
  for (const r of required) {
    if (!keyed.some((i) => (i as unknown as { category: string }).category === r.category)) throw new ActionError(r.message);
  }
  await assertStatusesRemovable(kind, before, keyed);
  return saveConfig(user, section, label, keyed as unknown as AppSettings[K]);
}

export async function saveProjectStatuses(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const data = parse(statusItems(PROJECT_CATEGORIES), input);
    return saveStatusList("projectStatuses", "project", "Project statuses", data.items as { key?: string; label: string }[], [
      { category: "completed", message: "Keep at least one status in the Completed category." },
    ]);
  }, "Project statuses saved");
}

export async function saveTaskStatuses(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const data = parse(statusItems(TASK_CATEGORIES), input);
    return saveStatusList("taskStatuses", "task", "Task statuses", data.items as { key?: string; label: string }[], [
      { category: "done", message: "Keep at least one status in the Done category." },
    ]);
  }, "Task statuses saved");
}

export async function savePipelineStages(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const data = parse(statusItems(PIPELINE_CATEGORIES, { probability: zs.num("Probability", { min: 0, max: 100 }) }), input);
    const items = (data.items as unknown as { key?: string; label: string; probability: number }[]).map((i) => ({ ...i, probability: Math.round(i.probability) }));
    return saveStatusList("pipelineStages", "pipeline", "CRM pipeline stages", items, [
      { category: "won", message: "Keep at least one stage in the Won category." },
      { category: "lost", message: "Keep at least one stage in the Lost category." },
    ]);
  }, "Pipeline stages saved");
}

export async function saveEmploymentStatuses(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const data = parse(statusItems(EMPLOYMENT_CATEGORIES), input);
    return saveStatusList("employmentStatuses", "employment", "Employment statuses", data.items as { key?: string; label: string }[], [
      { category: "active", message: "Keep at least one status in the Active category." },
      { category: "exited", message: "Keep at least one status in the Exited category." },
    ]);
  }, "Employment statuses saved");
}

/* ───────────────────────────── Lists ───────────────────────────── */

const simpleListSchema = z.object({
  list: z.enum(["expenseCategories", "assetCategories", "companyAssetCategories", "leadSources"]),
  items: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []),
    z.array(z.string().max(60, "Keep each entry under 60 characters")).min(1, "Keep at least one entry").max(100),
  ),
});

const LIST_LABELS = { expenseCategories: "Expense categories", assetCategories: "Staff asset categories", companyAssetCategories: "Company asset categories", leadSources: "Lead sources" } as const;

export async function saveSimpleList(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(simpleListSchema, input);
    assertUniqueLabels(data.items, "entry");
    return saveConfig(user, data.list, LIST_LABELS[data.list], data.items);
  }, "List saved");
}

const documentCategoriesSchema = z.object({
  items: rows(
    z.object({
      key: zs.optText(80),
      label: zs.text("Category name", 80),
      required: zs.bool(),
      appliesTo: personTypes,
      hasExpiry: zs.bool(),
      confidential: zs.bool(),
    }),
    60,
  ),
});

export async function saveDocumentCategories(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(documentCategoriesSchema, input);
    if (data.items.length === 0) throw new ActionError("Keep at least one document category.");
    assertUniqueLabels(data.items.map((i) => i.label), "document category");
    const before = (await getSettings()).documentCategories;
    const keyed = assignKeys(data.items, before, (i) => i.label);
    const nextKeys = new Set(keyed.map((k) => k.key));
    const removed = before.filter((c) => !nextKeys.has(c.key));
    if (removed.length > 0) {
      const used = await db()
        .select({ key: StoredFile.category, n: count() })
        .from(StoredFile)
        .where(and(inList(StoredFile.category, removed.map((r) => r.key)), isNull(StoredFile.deletedAt)))
        .groupBy(StoredFile.category);
      if (used.length > 0) {
        const names = used.map((u) => `"${before.find((c) => c.key === u.key)?.label ?? u.key}" (${u.n} files)`).join(", ");
        throw new ActionError(`Can't remove ${names} because documents are filed under it. Rename it instead.`);
      }
    }
    return saveConfig(user, "documentCategories", "Document categories", keyed);
  }, "Document categories saved");
}

/* ───────────────────────────── Numbering & templates ───────────────────────────── */

const prefix = (label: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(24, `${label} is too long`).regex(/^[A-Za-z0-9\-_/.]*$/, "Use letters, numbers and - _ / . only"));

const numberingSchema = z.object({
  invoicePrefix: prefix("Invoice prefix"),
  invoicePadding: zs.num("Number length", { min: 1, max: 8 }),
  invoiceIncludeFiscalYear: zs.bool(),
  proposalPrefix: prefix("Proposal prefix"),
  certificatePrefix: prefix("Certificate prefix"),
});

export async function saveNumbering(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(numberingSchema, input);
    return saveConfig(user, "numbering", "Document numbering", { ...data, invoicePadding: Math.round(data.invoicePadding) });
  }, "Numbering saved");
}

const taxesSchema = z.object({
  taxes: rows(z.object({ name: zs.text("Tax name", 40), rate: zs.num("Tax rate", { min: 0.01, max: 100 }) }), 30),
  paymentTerms: rows(z.object({ label: zs.text("Term name", 40), days: zs.num("Days", { min: 0, max: 365 }) }), 30),
});

export async function saveTaxesAndTerms(input: Record<string, unknown>): Promise<ActionResult<{ changed: number }>> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(taxesSchema, input);
    if (data.paymentTerms.length === 0) throw new ActionError("Keep at least one payment term.");
    assertUniqueLabels(data.taxes.map(taxLabel), "tax rate");
    assertUniqueLabels(data.paymentTerms.map((t) => t.label), "payment term");
    const taxes = await saveConfig(user, "taxes", "Tax rates", data.taxes);
    const terms = await saveConfig(
      user,
      "paymentTerms",
      "Payment terms",
      data.paymentTerms.map((t) => ({ label: t.label, days: Math.round(t.days) })),
    );
    return { changed: taxes.changed + terms.changed };
  }, "Taxes and payment terms saved");
}

const ALLOWED_PLACEHOLDERS = new Set(["name", "firstName", "company", "role", "start", "end"]);

const documentsSchema = z.object({
  invoiceNotes: zs.optText(1000),
  invoiceTerms: zs.optText(2000),
  proposalTerms: zs.optText(2000),
  payslipFooter: zs.optText(500),
  certificateText: zs.text("Certificate text", 2000),
});

export async function saveDocumentTemplates(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(documentsSchema, input);
    const unknown = [...data.certificateText.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => !ALLOWED_PLACEHOLDERS.has(p));
    if (unknown.length > 0) fieldError("certificateText", `Unknown placeholder ${[...new Set(unknown)].map((p) => `{${p}}`).join(", ")}`);
    const before = (await getSettings()).documents;
    return saveConfig(user, "documents", "Document templates", {
      invoiceNotes: data.invoiceNotes ?? "",
      invoiceTerms: data.invoiceTerms ?? "",
      proposalTerms: data.proposalTerms ?? "",
      payslipFooter: data.payslipFooter ?? "",
      certificateText: data.certificateText,
      // Edited under GST & bank details.
      bankDetails: before.bankDetails,
    });
  }, "Templates saved");
}

/* ───────────────────────────── Notifications ───────────────────────────── */

const notificationsSchema = z.object({
  inApp: zs.bool(),
  email: zs.bool(),
  reminderDaysBefore: zs.num("Reminder lead time", { min: 1, max: 60 }),
});

export async function saveNotifications(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const data = parse(notificationsSchema, input);
    const events: Record<string, boolean> = {};
    for (const e of NOTIFICATION_EVENTS) events[e.key] = zs.bool().parse(input[`event_${e.key}`]);
    if (!data.inApp && !data.email) throw new ActionError("Turn on at least one delivery channel (in-app or email).");
    return saveConfig(user, "notifications", "Notification settings", { ...data, reminderDaysBefore: Math.round(data.reminderDaysBefore), events });
  }, "Notification settings saved");
}

/* ───────────────────────────── Data & security ───────────────────────────── */

const dataSchema = z.object({
  auditRetentionDays: zs.num("Audit retention", { min: 90, max: 3650 }),
  notificationRetentionDays: zs.num("Notification retention", { min: 7, max: 730 }),
  backupRetentionCount: zs.num("Backups to keep", { min: 1, max: 90 }),
  autoBackup: zs.bool(),
  sessionHours: zs.num("Session length", { min: 1, max: 72 }),
  rememberDays: zs.num("Remember-me length", { min: 1, max: 90 }),
});

export async function saveDataSecurity(input: Record<string, unknown>): Promise<Saved> {
  return runAction(async () => {
    const user = await actionPermission("settings.manage");
    const d = parse(dataSchema, input);
    // Backup schedule and retention can wipe restore points, so they need backup.manage too.
    const backups = can(user, "backup.manage") ? { backupRetentionCount: Math.round(d.backupRetentionCount), autoBackup: d.autoBackup } : (({ backupRetentionCount, autoBackup }) => ({ backupRetentionCount, autoBackup }))((await getSettings()).data);
    const data = await saveConfig(user, "data", "Data retention & backups", {
      auditRetentionDays: Math.round(d.auditRetentionDays),
      notificationRetentionDays: Math.round(d.notificationRetentionDays),
      ...backups,
    });
    const security = await saveConfig(user, "security", "Session security", { sessionHours: Math.round(d.sessionHours), rememberDays: Math.round(d.rememberDays) });
    return { changed: data.changed + security.changed };
  }, "Data and security settings saved");
}
