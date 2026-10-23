"use server";

import { z } from "zod";
import { actionUser, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import type { CurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { Project, Types, VAULT_ENVIRONMENTS, VAULT_KINDS, VaultEvent, VaultItem, type IVaultItem, type VaultKind } from "@/lib/models";
import { isObjectId, zs } from "@/lib/validation";
import { VaultKeyError } from "@/lib/vault/crypto";
import { parseDotenv, type EnvEntry } from "@/lib/vault/dotenv";
import {
  canManageItem,
  canSeeItem,
  logVaultEvent,
  openPayload,
  payloadFields,
  projectDataKey,
  REVEAL_ACTIONS,
  sealPayload,
  vaultRole,
  type VaultPayload,
} from "@/lib/vault/service";

/** Reveals per person per 10 minutes before further requests are refused. */
const REVEAL_LIMIT = 120;
const MAX_ITEMS_PER_PROJECT = 300;

async function loadVaultProject(user: CurrentUser, projectId: string) {
  if (!isObjectId(projectId)) throw new ActionError("Project not found.");
  const project = await Project.findById(projectId, { projectNo: 1, title: 1, manager: 1, team: 1 }).lean();
  if (!project) throw new ActionError("Project not found.");
  const role = vaultRole(user, project);
  if (!role) throw new ActionError("Only the project manager and team members can use this project's secrets.");
  return { project, role };
}

async function loadItem(user: CurrentUser, projectId: string, itemId: string, need: "see" | "manage") {
  const { project, role } = await loadVaultProject(user, projectId);
  if (!isObjectId(itemId)) throw new ActionError("Secret not found.");
  const item = await VaultItem.findOne({ _id: itemId, project: project._id });
  if (!item || !canSeeItem(user, role, item)) throw new ActionError("Secret not found, or it isn't shared with you.");
  if (need === "manage" && !canManageItem(user, role, item)) throw new ActionError("Only the project manager or the person who added this secret can change it.");
  return { project, role, item };
}

/** Key errors (vault not configured / wrong master key) become readable action errors. */
async function dataKey(projectId: Types.ObjectId, create: boolean): Promise<Buffer> {
  try {
    const key = await projectDataKey(projectId, create);
    if (!key) throw new ActionError("This project's vault has no key yet.");
    return key;
  } catch (error) {
    if (error instanceof VaultKeyError) throw new ActionError(error.message);
    throw error;
  }
}

function decrypt(key: Buffer, item: IVaultItem): VaultPayload {
  try {
    return openPayload(key, item);
  } catch (error) {
    if (error instanceof VaultKeyError) throw new ActionError(error.message);
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/** Raw (untrimmed) string: secrets may legitimately start or end with spaces. */
const raw = (max: number, message: string) => z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().max(max, message));

const metaSchema = z.object({
  name: zs.text("Name", 120),
  description: zs.optText(300),
  rotateBy: zs.optDate(),
});

const envSchema = z.object({
  environment: z.enum(VAULT_ENVIRONMENTS, { error: "Choose an environment" }),
  content: raw(64 * 1024, "The file is too large (64 KB max)"),
});

const credentialSchema = z.object({
  url: zs.optText(500),
  username: zs.optText(300),
  password: raw(2000, "Password is too long"),
  notes: zs.optText(5000),
});

const noteSchema = z.object({ content: raw(20_000, "The note is too long (20,000 characters max)") });

const accessSchema = z.object({
  audience: z.enum(["team", "selected"], { error: "Choose who can see it" }),
  members: zs.ids(),
  notifyOnReveal: zs.bool(),
});

function buildPayload(kind: VaultKind, input: Record<string, unknown>, existing: VaultPayload | null): { payload: VaultPayload; environment?: (typeof VAULT_ENVIRONMENTS)[number]; entryCount: number } {
  if (kind === "env") {
    const data = parse(envSchema, input);
    const { entries, errors } = parseDotenv(data.content);
    if (errors.length) throw new ActionError("The .env content has problems.", { content: errors.slice(0, 3).join(" · ") });
    if (entries.length === 0) throw new ActionError("Add at least one variable.", { content: "Add at least one KEY=value line" });
    return { payload: { kind, entries }, environment: data.environment, entryCount: entries.length };
  }
  if (kind === "credential") {
    const data = parse(credentialSchema, input);
    const keep = existing?.kind === "credential" ? existing.password : undefined;
    const password = data.password !== "" ? data.password : keep;
    if (!password) throw new ActionError("Enter the password or secret.", { password: "Required" });
    // The URL and username are shown on the Secrets tab without a reveal event, so they must not carry secrets.
    if (data.url && /^[a-z][a-z0-9+.-]*:\/\//i.test(data.url)) {
      const u = new URL(data.url);
      if (u.username || u.password || u.search) throw new ActionError("Keep credentials and tokens out of the URL — put them in the password or notes field.", { url: "Remove the user:password@ and ?query parts" });
    }
    return { payload: { kind, url: data.url, username: data.username, password, notes: data.notes }, entryCount: 0 };
  }
  const data = parse(noteSchema, input);
  if (!data.content.trim()) throw new ActionError("Write the note.", { content: "Required" });
  return { payload: { kind, content: data.content }, entryCount: 0 };
}

/** Selected members must be on the team (the manager always has access). */
function cleanMembers(project: { team: { user: Types.ObjectId }[] }, ids: string[]): Types.ObjectId[] {
  const onTeam = new Set(project.team.map((m) => m.user.toString()));
  const invalid = ids.filter((id) => !onTeam.has(id));
  if (invalid.length) throw new ActionError("Only project team members can be given access.", { members: "Choose people from the project team" });
  return [...new Set(ids)].map((id) => new Types.ObjectId(id));
}

/* ------------------------------------------------------------------ */
/* Create / update / delete                                            */
/* ------------------------------------------------------------------ */

export async function createVaultItem(projectId: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project } = await loadVaultProject(user, projectId);
    const kind = parse(z.object({ kind: z.enum(VAULT_KINDS, { error: "Choose a type" }) }), input).kind;
    const meta = parse(metaSchema, input);
    const access = parse(accessSchema, input);
    const members = cleanMembers(project, access.members);
    const { payload, environment, entryCount } = buildPayload(kind, input, null);
    if ((await VaultItem.countDocuments({ project: project._id })) >= MAX_ITEMS_PER_PROJECT) throw new ActionError(`A project can hold at most ${MAX_ITEMS_PER_PROJECT} secrets.`);

    const key = await dataKey(project._id, true);
    const id = new Types.ObjectId();
    await VaultItem.create({
      _id: id,
      project: project._id,
      kind,
      name: meta.name,
      description: meta.description,
      environment,
      ciphertext: sealPayload(key, project._id, id, payload),
      entryCount,
      audience: access.audience,
      members,
      notifyOnReveal: access.notifyOnReveal,
      rotateBy: meta.rotateBy,
      version: 1,
      valuesUpdatedAt: new Date(),
      createdBy: user._id,
      updatedBy: user._id,
    });
    await logVaultEvent(user, { project: project._id, item: id, itemName: meta.name, action: "create" });
    await audit(user, { action: "create", entity: "vault_item", entityId: id, ref: project.projectNo, summary: `Added secret "${meta.name}" to ${project.projectNo}` });
    return { id: id.toString() };
  }, "Secret saved");
}

/** Updates the values and details of an item (re-encrypted with a fresh IV). */
export async function updateVaultItem(projectId: string, itemId: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project, item } = await loadItem(user, projectId, itemId, "manage");
    const meta = parse(metaSchema, input);
    const key = await dataKey(project._id, false);
    const current = decrypt(key, item);
    const { payload, environment, entryCount } = buildPayload(item.kind, input, current);
    const valuesChanged = JSON.stringify(payload) !== JSON.stringify(current);

    item.name = meta.name;
    item.description = meta.description;
    item.rotateBy = meta.rotateBy;
    if (environment) item.environment = environment;
    item.ciphertext = sealPayload(key, project._id, item._id, payload);
    item.entryCount = entryCount;
    item.updatedBy = user._id;
    if (valuesChanged) {
      item.version += 1;
      item.valuesUpdatedAt = new Date();
      item.rotationAdvisedAt = undefined;
      item.rotationAdvisedReason = undefined;
    }
    await item.save();
    await logVaultEvent(user, { project: project._id, item: item._id, itemName: item.name, action: "update" });
    await audit(user, {
      action: "update",
      entity: "vault_item",
      entityId: item._id,
      ref: project.projectNo,
      summary: `${valuesChanged ? "Changed the values of" : "Updated the details of"} secret "${item.name}" in ${project.projectNo}`,
    });
    return null;
  }, "Secret updated");
}

export async function updateVaultAccess(projectId: string, itemId: string, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project, item } = await loadItem(user, projectId, itemId, "manage");
    const access = parse(accessSchema, input);
    const members = cleanMembers(project, access.members);
    const before = `${item.audience}:${item.members.map(String).sort().join(",")}:${item.notifyOnReveal}`;
    item.audience = access.audience;
    item.set("members", members);
    item.notifyOnReveal = access.notifyOnReveal;
    item.updatedBy = user._id;
    await item.save();
    const after = `${item.audience}:${item.members.map(String).sort().join(",")}:${item.notifyOnReveal}`;
    if (before !== after) {
      await logVaultEvent(user, { project: project._id, item: item._id, itemName: item.name, action: "access" });
      await audit(user, {
        action: "access",
        entity: "vault_item",
        entityId: item._id,
        ref: project.projectNo,
        summary: `Changed who can see secret "${item.name}" in ${project.projectNo} (${item.audience === "team" ? "whole team" : `${members.length} selected`})`,
      });
    }
    return null;
  }, "Sharing updated");
}

export async function deleteVaultItem(projectId: string, itemId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project, item } = await loadItem(user, projectId, itemId, "manage");
    await item.deleteOne();
    await logVaultEvent(user, { project: project._id, item: item._id, itemName: item.name, action: "delete" });
    await audit(user, { action: "delete", entity: "vault_item", entityId: item._id, ref: project.projectNo, summary: `Deleted secret "${item.name}" from ${project.projectNo}` });
    return null;
  }, "Secret deleted");
}

export async function dismissRotationAdvice(projectId: string, itemId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionUser();
    const { project, item } = await loadItem(user, projectId, itemId, "manage");
    item.rotationAdvisedAt = undefined;
    item.rotationAdvisedReason = undefined;
    await item.save();
    await logVaultEvent(user, { project: project._id, item: item._id, itemName: item.name, action: "update", field: "rotation advice dismissed" });
    await audit(user, { action: "update", entity: "vault_item", entityId: item._id, ref: project.projectNo, summary: `Dismissed the rotation advice for secret "${item.name}" in ${project.projectNo}` });
    return null;
  }, "Rotation advice dismissed");
}

/* ------------------------------------------------------------------ */
/* Reveal                                                              */
/* ------------------------------------------------------------------ */

const revealSchema = z.object({
  purpose: z.enum(["reveal", "copy", "download", "edit_open"]),
  field: z.string().max(200).optional(),
});

const PURPOSE_VERB: Record<string, string> = { reveal: "viewed", copy: "copied", download: "downloaded", edit_open: "opened for editing" };

/**
 * Decrypts an item for the caller — all fields, or only `field` (one variable / the password) so a
 * single copy never exposes the rest. Every call is rate limited, written to the vault access log and
 * the audit trail, and (when the item asks for it) notified to the project manager and the item's owner.
 */
export async function revealVaultItem(projectId: string, itemId: string, purpose: string, field?: string): Promise<ActionResult<{ entries: EnvEntry[] }>> {
  return runAction(async () => {
    const user = await actionUser();
    const req = parse(revealSchema, { purpose, field: field || undefined });
    const { project, item } = await loadItem(user, projectId, itemId, req.purpose === "edit_open" ? "manage" : "see");

    const recent = await VaultEvent.countDocuments({ user: user._id, action: { $in: REVEAL_ACTIONS }, at: { $gt: new Date(Date.now() - 10 * 60_000) } });
    if (recent >= REVEAL_LIMIT) throw new ActionError("Too many secret requests in a short time. Please wait a few minutes.");

    const key = await dataKey(project._id, false);
    const all = payloadFields(decrypt(key, item));
    const entries = req.field ? all.filter((e) => e.key === req.field) : all;
    if (req.field && entries.length === 0) throw new ActionError("That value no longer exists. Refresh the page.");

    await logVaultEvent(user, { project: project._id, item: item._id, itemName: item.name, action: req.purpose, field: req.field });
    const what = req.field ? `${req.field} of "${item.name}"` : `"${item.name}"`;
    await audit(user, { action: "access", entity: "vault_item", entityId: item._id, ref: project.projectNo, summary: `${PURPOSE_VERB[req.purpose]} secret ${what} in ${project.projectNo}` });
    if (item.notifyOnReveal) {
      const hour = new Date().toISOString().slice(0, 13);
      await notify(
        [project.manager, item.createdBy],
        {
          type: "project",
          title: `${user.name} ${PURPOSE_VERB[req.purpose]} ${item.name}`,
          body: `${req.field ? `${req.field} · ` : ""}${project.projectNo} · ${project.title}`,
          link: `/projects/${project._id}?tab=secrets`,
          priority: item.environment === "production" ? "high" : "normal",
          dedupeKey: `vault:${item._id}:${user.id}:${req.purpose}:${req.field ?? "*"}:${hour}`,
        },
        [user._id],
      );
    }
    return { entries };
  });
}
