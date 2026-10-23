"use server";

import { z } from "zod";
import type { Types, UpdateQuery } from "mongoose";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff, type AuditAction } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { resolveFileRefs } from "@/lib/files";
import { escapeRegex } from "@/lib/format";
import { Asset, Department, User, type AssetStatus, type IAsset } from "@/lib/models";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { statusLabel } from "@/lib/status";
import { fmtDate, todayKey, zonedDateTime } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { ASSET_CONDITIONS } from "./meta";

type Lean = IAsset;

function fieldError(field: string, message: string): never {
  throw new ActionError(message, { [field]: message });
}

const condition = z.enum(ASSET_CONDITIONS, { error: "Choose a condition" });
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/* ───────────────────────────── Create / edit ───────────────────────────── */

const assetSchema = z.object({
  id: zs.optId(),
  name: zs.text("Name", 200),
  category: zs.text("Category", 60),
  brand: zs.optText(100),
  model: zs.optText(100),
  serialNo: zs.optText(100),
  purchaseDate: zs.optDate(),
  cost: zs.optNum({ min: 0 }),
  vendor: zs.optText(150),
  invoiceRef: zs.optText(100),
  warrantyUntil: zs.optDate(),
  serviceProvider: zs.optText(150),
  nextServiceDate: zs.optDate(),
  department: zs.optId(),
  location: zs.optText(150),
  condition,
  notes: zs.optText(2000),
  documents: zs.ids(),
});

async function duplicateSerials(serial: string | undefined, excludeId?: string): Promise<{ id: string; assetNo: string; name: string }[]> {
  if (!serial) return [];
  const rows = await Asset.find({ serialNo: new RegExp(`^${escapeRegex(serial)}$`, "i"), ...(excludeId ? { _id: { $ne: excludeId } } : {}) }, { assetNo: 1, name: 1 })
    .limit(5)
    .lean();
  return rows.map((r) => ({ id: r._id.toString(), assetNo: r.assetNo, name: r.name }));
}

/** Inline duplicate-serial check used by the form (does not block saving). */
export async function findDuplicateSerial(serial: string, excludeId?: string): Promise<ActionResult<{ id: string; assetNo: string; name: string }[]>> {
  return runAction(async () => {
    await actionPermission("assets.manage");
    return duplicateSerials(serial.trim() || undefined, excludeId && isObjectId(excludeId) ? excludeId : undefined);
  });
}

const FIELD_LABELS = ["name", "category", "brand", "model", "serialNo", "purchaseDate", "cost", "vendor", "invoiceRef", "warrantyUntil", "serviceProvider", "nextServiceDate", "department", "location", "condition", "notes"] as const;

export async function saveAsset(input: Record<string, unknown>): Promise<ActionResult<{ id: string; assetNo: string; duplicates: string[] }>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(assetSchema, input);
    const existing = data.id ? await Asset.findById(data.id).lean() : null;
    if (data.id && !existing) throw new ActionError("Asset not found");

    const settings = await getSettings();
    if (!settings.assetCategories.includes(data.category) && existing?.category !== data.category) fieldError("category", "Choose a category from the list");
    if (data.department && !(await Department.exists({ _id: data.department }))) fieldError("department", "Department not found");
    if (data.purchaseDate && data.warrantyUntil && data.warrantyUntil < data.purchaseDate) fieldError("warrantyUntil", "Warranty can't end before the purchase date");

    const duplicates = await duplicateSerials(data.serialNo, data.id);
    const values = {
      name: data.name,
      category: data.category,
      brand: data.brand,
      model: data.model,
      serialNo: data.serialNo,
      purchaseDate: data.purchaseDate,
      cost: data.cost ?? 0,
      vendor: data.vendor,
      invoiceRef: data.invoiceRef,
      warrantyUntil: data.warrantyUntil,
      serviceProvider: data.serviceProvider,
      nextServiceDate: data.nextServiceDate,
      department: data.department,
      location: data.location,
      condition: data.condition,
      notes: data.notes,
    };
    const dupNote = duplicates.length ? ` · duplicate serial of ${duplicates.map((d) => d.assetNo).join(", ")}` : "";

    if (!existing) {
      const assetNo = await nextNumber("asset", ID_PREFIX.asset, 4);
      const documents = await resolveFileRefs(user, data.documents);
      const doc = await Asset.create({
        ...values,
        assetNo,
        status: "available",
        documents,
        history: [{ action: "created", by: user._id, byName: user.name, at: new Date(), note: "Added to inventory" }],
      });
      await audit(user, { action: "create", entity: "asset", entityId: doc._id, ref: assetNo, summary: `Added asset ${assetNo} · ${doc.name} (${doc.category})${dupNote}` });
      return { id: doc._id.toString(), assetNo, duplicates: duplicates.map((d) => d.assetNo) };
    }

    // Keep documents already attached (the user may not be allowed to re-resolve them); resolve only new ids.
    const keep = existing.documents.filter((d) => data.documents.includes(d.file.toString()));
    const fresh = await resolveFileRefs(
      user,
      data.documents.filter((id) => !existing.documents.some((d) => d.file.toString() === id)),
    );
    const documents = [...keep, ...fresh];

    const before = Object.fromEntries(FIELD_LABELS.map((f) => [f, f === "department" ? existing.department?.toString() : existing[f]])) as Record<string, unknown>;
    const after = values as Record<string, unknown>;
    const changes = diff(before, after, [...FIELD_LABELS]);
    const docChange = documents.length !== existing.documents.length || keep.length !== existing.documents.length;

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === "") unset[k] = "";
      else set[k] = v;
    }
    if (changes.length === 0 && !docChange) return { id: existing._id.toString(), assetNo: existing.assetNo, duplicates: duplicates.map((d) => d.assetNo) };

    const update: UpdateQuery<IAsset> = {
      $set: { ...set, documents },
      $push: { history: { action: "edited", by: user._id, byName: user.name, at: new Date(), note: [...changes.map((c) => c.field), ...(docChange ? ["documents"] : [])].join(", ") } },
    };
    if (Object.keys(unset).length) update.$unset = unset;
    await Asset.updateOne({ _id: existing._id }, update);
    await audit(user, {
      action: "update",
      entity: "asset",
      entityId: existing._id,
      ref: existing.assetNo,
      summary: `Updated asset ${existing.assetNo} · ${[...changes.map((c) => c.field), ...(docChange ? ["documents"] : [])].join(", ")}${dupNote}`,
      changes,
    });
    return { id: existing._id.toString(), assetNo: existing.assetNo, duplicates: duplicates.map((d) => d.assetNo) };
  }, "Asset saved");
}

/* ───────────────────────────── Lifecycle actions ───────────────────────────── */

async function loadAsset(id: string): Promise<Lean> {
  if (!isObjectId(id)) throw new ActionError("Asset not found");
  const asset = await Asset.findById(id).lean();
  if (!asset) throw new ActionError("Asset not found");
  return asset;
}

function effectiveAt(date: string): Date {
  if (date > todayKey()) throw new ActionError("The date can't be in the future.", { date: "The date can't be in the future" });
  return date === todayKey() ? new Date() : zonedDateTime(date, "12:00");
}

async function staffMember(id: string) {
  const person = await User.findOne({ _id: id, personType: { $in: ["employee", "trainee", "intern"] }, status: { $nin: EXITED_STATUSES } }, { name: 1, department: 1 }).lean();
  if (!person) throw new ActionError("Choose a current staff member.", { person: "Choose a current staff member" });
  return person;
}

async function nameOf(id: Types.ObjectId | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  return (await User.findById(id, { name: 1 }).lean())?.name;
}

interface Mutation {
  allowed: AssetStatus[];
  verb: string;
  set: Record<string, unknown>;
  unset?: string[];
  entry: { action: string; note?: string; from?: string; to?: string; user?: Types.ObjectId; userName?: string; at: Date };
}

/** Applies a status change guarded by the asset's current status and appends the history entry. */
async function mutate(actor: CurrentUser, asset: Lean, m: Mutation): Promise<void> {
  if (!m.allowed.includes(asset.status)) {
    throw new ActionError(`${asset.assetNo} is ${statusLabel("asset", asset.status).toLowerCase()} and can't be ${m.verb}.`);
  }
  const update: UpdateQuery<IAsset> = {
    $set: m.set,
    $push: { history: { ...m.entry, by: actor._id, byName: actor.name } },
  };
  if (m.unset?.length) update.$unset = Object.fromEntries(m.unset.map((k) => [k, ""]));
  const res = await Asset.updateOne({ _id: asset._id, status: asset.status }, update);
  if (res.matchedCount === 0) throw new ActionError("This asset was just changed by someone else. Reload the page and try again.");
}

function record(
  actor: CurrentUser,
  asset: Lean,
  action: AuditAction,
  summary: string,
  changes: { field: string; from?: unknown; to?: unknown }[],
): Promise<void> {
  return audit(actor, { action, entity: "asset", entityId: asset._id, ref: asset.assetNo, summary, changes });
}

const note = zs.optText(500);
const requiredNote = (label: string) => zs.text(label, 500);
const assetLink = (asset: Lean) => `/assets/${asset._id.toString()}`;

const issueSchema = z.object({ person: zs.id("Person"), date: zs.date("Issue date"), condition, note });

export async function issueAsset(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(issueSchema, input);
    const asset = await loadAsset(id);
    const person = await staffMember(data.person);
    const at = effectiveAt(data.date);
    await mutate(user, asset, {
      allowed: ["available"],
      verb: "issued",
      set: { status: "assigned", assignedTo: person._id, condition: data.condition },
      entry: { action: "issued", from: "In stock", to: person.name, user: person._id, userName: person.name, note: [`Condition: ${data.condition}`, data.note].filter(Boolean).join(" · "), at },
    });
    await record(user, asset, "assign", `Issued ${asset.assetNo} (${asset.name}) to ${person.name} on ${fmtDate(data.date)}`, [
      { field: "status", from: asset.status, to: "assigned" },
      { field: "assignedTo", from: undefined, to: person.name },
      { field: "condition", from: asset.condition, to: data.condition },
    ]);
    await notify([person._id], { type: "asset", title: `Asset issued to you: ${asset.name}`, body: `${asset.assetNo} was issued to you on ${fmtDate(data.date)} (condition: ${data.condition}). Take care of it and report any fault.`, link: assetLink(asset) }, [user._id]);
    return null;
  }, "Asset issued");
}

const returnSchema = z.object({ date: zs.date("Return date"), condition, note });

export async function returnAsset(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(returnSchema, input);
    const asset = await loadAsset(id);
    const holder = await nameOf(asset.assignedTo);
    const at = effectiveAt(data.date);
    const status: AssetStatus = data.condition === "damaged" ? "damaged" : "available";
    await mutate(user, asset, {
      allowed: ["assigned"],
      verb: "returned",
      set: { status, condition: data.condition },
      unset: ["assignedTo"],
      entry: { action: "returned", from: holder, to: status === "damaged" ? "Damaged" : "In stock", user: asset.assignedTo, userName: holder, note: [`Condition on return: ${data.condition}`, data.note].filter(Boolean).join(" · "), at },
    });
    await record(user, asset, "assign", `Recorded return of ${asset.assetNo} (${asset.name}) from ${holder ?? "holder"} on ${fmtDate(data.date)} · condition ${data.condition}`, [
      { field: "status", from: asset.status, to: status },
      { field: "assignedTo", from: holder, to: undefined },
      { field: "condition", from: asset.condition, to: data.condition },
    ]);
    await notify([asset.assignedTo], { type: "asset", title: `Return recorded: ${asset.name}`, body: `${asset.assetNo} was returned on ${fmtDate(data.date)}. Thank you.`, link: assetLink(asset) }, [user._id]);
    return null;
  }, "Return recorded");
}

const transferSchema = z.object({ toPerson: zs.optId(), toDepartment: zs.optId(), date: zs.date("Transfer date"), note });

export async function transferAsset(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(transferSchema, input);
    const asset = await loadAsset(id);
    if (!data.toPerson && !data.toDepartment) throw new ActionError("Choose a person, a department, or both.", { toPerson: "Choose a person or a department" });
    if (data.toPerson && asset.status !== "assigned") throw new ActionError("Only an issued asset can be transferred to another person. Issue it instead.", { toPerson: "Issue the asset instead" });
    if (data.toPerson && asset.assignedTo?.toString() === data.toPerson) throw new ActionError("The asset is already with this person.", { toPerson: "Already with this person" });
    if (!data.toPerson && data.toDepartment && asset.department?.toString() === data.toDepartment) throw new ActionError("The asset is already in this department.", { toDepartment: "Already in this department" });

    const person = data.toPerson ? await staffMember(data.toPerson) : null;
    const dept = data.toDepartment ? await Department.findById(data.toDepartment, { name: 1 }).lean() : null;
    if (data.toDepartment && !dept) fieldError("toDepartment", "Department not found");
    const oldDept = asset.department ? (await Department.findById(asset.department, { name: 1 }).lean())?.name : undefined;
    const oldHolder = await nameOf(asset.assignedTo);
    const at = effectiveAt(data.date);

    const set: Record<string, unknown> = {};
    if (person) set.assignedTo = person._id;
    if (dept) set.department = dept._id;
    await mutate(user, asset, {
      allowed: ["assigned", "available"],
      verb: "transferred",
      set,
      entry: {
        action: "transferred",
        from: [oldHolder, oldDept].filter(Boolean).join(" · ") || "In stock",
        to: [person?.name, dept?.name].filter(Boolean).join(" · "),
        user: person?._id,
        userName: person?.name,
        note: data.note,
        at,
      },
    });
    const changes = [
      ...(person ? [{ field: "assignedTo", from: oldHolder, to: person.name }] : []),
      ...(dept ? [{ field: "department", from: oldDept, to: dept.name }] : []),
    ];
    await record(user, asset, "assign", `Transferred ${asset.assetNo} (${asset.name}) to ${[person?.name, dept?.name].filter(Boolean).join(" / ")} on ${fmtDate(data.date)}`, changes);
    if (person) {
      await notify([person._id], { type: "asset", title: `Asset transferred to you: ${asset.name}`, body: `${asset.assetNo} was transferred to you on ${fmtDate(data.date)}.`, link: assetLink(asset) }, [user._id]);
      await notify([asset.assignedTo], { type: "asset", title: `Asset transferred away: ${asset.name}`, body: `${asset.assetNo} is no longer assigned to you.`, link: assetLink(asset) }, [user._id]);
    }
    return null;
  }, "Asset transferred");
}

const repairSchema = z.object({ provider: zs.optText(150), date: zs.date("Date sent"), note: requiredNote("Fault description") });

export async function sendToRepair(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(repairSchema, input);
    const asset = await loadAsset(id);
    const holder = await nameOf(asset.assignedTo);
    const at = effectiveAt(data.date);
    await mutate(user, asset, {
      allowed: ["available", "assigned", "damaged"],
      verb: "sent for repair",
      set: { status: "in_repair", ...(data.provider ? { serviceProvider: data.provider } : {}) },
      unset: ["assignedTo"],
      entry: { action: "sent_to_repair", from: holder ? `With ${holder}` : statusLabel("asset", asset.status), to: data.provider ?? "Repair", note: data.note, user: asset.assignedTo, userName: holder, at },
    });
    await record(user, asset, "status", `Sent ${asset.assetNo} (${asset.name}) for repair${data.provider ? ` to ${data.provider}` : ""} · ${data.note}`, [
      { field: "status", from: asset.status, to: "in_repair" },
      ...(holder ? [{ field: "assignedTo", from: holder, to: undefined }] : []),
    ]);
    await notify([asset.assignedTo], { type: "asset", title: `Asset sent for repair: ${asset.name}`, body: `${asset.assetNo} was collected for repair (${data.note}).`, link: assetLink(asset) }, [user._id]);
    return null;
  }, "Sent for repair");
}

const backSchema = z.object({ date: zs.date("Date back"), condition, note });

export async function backFromRepair(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(backSchema, input);
    const asset = await loadAsset(id);
    const at = effectiveAt(data.date);
    const status: AssetStatus = data.condition === "damaged" ? "damaged" : "available";
    await mutate(user, asset, {
      allowed: ["in_repair"],
      verb: "returned from repair",
      set: { status, condition: data.condition },
      entry: { action: "back_from_repair", from: "Repair", to: status === "damaged" ? "Damaged" : "In stock", note: [`Condition: ${data.condition}`, data.note].filter(Boolean).join(" · "), at },
    });
    await record(user, asset, "status", `${asset.assetNo} (${asset.name}) is back from repair · condition ${data.condition}`, [
      { field: "status", from: "in_repair", to: status },
      { field: "condition", from: asset.condition, to: data.condition },
    ]);
    return null;
  }, "Marked as back from repair");
}

const damagedSchema = z.object({ note: requiredNote("Description of the damage") });

export async function markDamaged(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(damagedSchema, input);
    const asset = await loadAsset(id);
    const holder = await nameOf(asset.assignedTo);
    await mutate(user, asset, {
      allowed: ["available", "assigned", "in_repair"],
      verb: "marked damaged",
      set: { status: "damaged", condition: "damaged" },
      unset: ["assignedTo"],
      entry: { action: "damaged", from: holder ? `With ${holder}` : statusLabel("asset", asset.status), to: "Damaged", note: data.note, user: asset.assignedTo, userName: holder, at: new Date() },
    });
    await record(user, asset, "status", `Marked ${asset.assetNo} (${asset.name}) as damaged · ${data.note}`, [
      { field: "status", from: asset.status, to: "damaged" },
      { field: "condition", from: asset.condition, to: "damaged" },
      ...(holder ? [{ field: "assignedTo", from: holder, to: undefined }] : []),
    ]);
    await notify([asset.assignedTo], { type: "asset", title: `Asset reported damaged: ${asset.name}`, body: `${asset.assetNo} was marked damaged and is no longer assigned to you.`, link: assetLink(asset) }, [user._id]);
    return null;
  }, "Marked as damaged");
}

const lostSchema = z.object({ note: requiredNote("Circumstances") });

export async function markLost(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(lostSchema, input);
    const asset = await loadAsset(id);
    const holder = await nameOf(asset.assignedTo);
    await mutate(user, asset, {
      allowed: ["available", "assigned", "in_repair", "damaged"],
      verb: "marked lost",
      set: { status: "lost" },
      unset: ["assignedTo"],
      entry: { action: "lost", from: holder ? `With ${holder}` : statusLabel("asset", asset.status), to: "Lost", note: data.note, user: asset.assignedTo, userName: holder, at: new Date() },
    });
    await record(user, asset, "status", `Marked ${asset.assetNo} (${asset.name}) as lost · ${data.note}`, [
      { field: "status", from: asset.status, to: "lost" },
      ...(holder ? [{ field: "assignedTo", from: holder, to: undefined }] : []),
    ]);
    await notify([asset.assignedTo], { type: "asset", title: `Asset marked lost: ${asset.name}`, body: `${asset.assetNo} was marked lost. ${data.note}`, link: assetLink(asset), priority: "high" }, [user._id]);
    return null;
  }, "Marked as lost");
}

const retireSchema = z.object({ reason: requiredNote("Reason") });

export async function retireAsset(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(retireSchema, input);
    const asset = await loadAsset(id);
    await mutate(user, asset, {
      allowed: ["available", "in_repair", "damaged", "lost"],
      verb: "retired",
      set: { status: "retired" },
      entry: { action: "retired", from: statusLabel("asset", asset.status), to: "Retired", note: data.reason, at: new Date() },
    });
    await record(user, asset, "status", `Retired ${asset.assetNo} (${asset.name}) · ${data.reason}`, [{ field: "status", from: asset.status, to: "retired" }]);
    return null;
  }, "Asset retired");
}

const restoreSchema = z.object({ condition, note });

export async function restoreAsset(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(restoreSchema, input);
    const asset = await loadAsset(id);
    await mutate(user, asset, {
      allowed: ["damaged", "lost"],
      verb: "returned to stock",
      set: { status: "available", condition: data.condition },
      entry: { action: "restored", from: statusLabel("asset", asset.status), to: "In stock", note: [`Condition: ${data.condition}`, data.note].filter(Boolean).join(" · "), at: new Date() },
    });
    await record(user, asset, "status", `Returned ${asset.assetNo} (${asset.name}) to stock after being ${asset.status}`, [
      { field: "status", from: asset.status, to: "available" },
      { field: "condition", from: asset.condition, to: data.condition },
    ]);
    return null;
  }, "Returned to stock");
}

const serviceSchema = z.object({ date: zs.date("Service date"), provider: zs.optText(150), note, nextServiceDate: zs.optDate() });

export async function recordService(id: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("assets.manage");
    const data = parse(serviceSchema, input);
    const asset = await loadAsset(id);
    const at = effectiveAt(data.date);
    if (data.nextServiceDate && data.nextServiceDate <= data.date) fieldError("nextServiceDate", "The next service must be after this one");
    const provider = optStr(data.provider) ?? asset.serviceProvider;
    await mutate(user, asset, {
      allowed: ["available", "assigned", "in_repair", "damaged"],
      verb: "serviced",
      set: { ...(provider ? { serviceProvider: provider } : {}), ...(data.nextServiceDate ? { nextServiceDate: data.nextServiceDate } : {}) },
      unset: data.nextServiceDate ? [] : ["nextServiceDate"],
      entry: { action: "serviced", from: asset.nextServiceDate ? `Due ${fmtDate(asset.nextServiceDate)}` : undefined, to: data.nextServiceDate ? `Next ${fmtDate(data.nextServiceDate)}` : "No further service scheduled", note: [data.provider, data.note].filter(Boolean).join(" · ") || undefined, at },
    });
    await record(user, asset, "update", `Recorded service of ${asset.assetNo} (${asset.name}) on ${fmtDate(data.date)}${data.nextServiceDate ? ` · next due ${fmtDate(data.nextServiceDate)}` : ""}`, [
      { field: "nextServiceDate", from: asset.nextServiceDate, to: data.nextServiceDate },
      ...(provider !== asset.serviceProvider ? [{ field: "serviceProvider", from: asset.serviceProvider, to: provider }] : []),
    ]);
    return null;
  }, "Service recorded");
}
