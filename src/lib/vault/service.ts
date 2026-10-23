import "server-only";
import { connectDB } from "@/lib/db";
import { requestMeta, type CurrentUser } from "@/lib/auth/session";
import { Project, ProjectVault, VaultEvent, VaultItem, type IVaultItem, type ObjectId, type VaultEventAction, type VaultKind } from "@/lib/models";
import { currentMasterKey, itemAad, newDataKey, previousMasterKey, seal, unseal, unwrapDataKey, VaultKeyError, wrapDataKey } from "./crypto";
import type { EnvEntry } from "./dotenv";

/**
 * Who may use a project's vault. Access follows project MEMBERSHIP, not organisation-wide permissions:
 * `projects.view_all` / `projects.manage` holders who are not on the team get nothing. The super admin
 * (single env-configured owner account) keeps break-glass access to every vault.
 *
 *   owner  — the project manager and the super admin: see and manage every item, see the access log
 *   member — team members: see items shared with the whole team or with them; manage items they created
 */
export type VaultRole = "owner" | "member";

type Id = { toString(): string };

export function vaultRole(user: Pick<CurrentUser, "id" | "isSuperAdmin">, project: { manager?: Id | null; team?: { user: Id }[] }): VaultRole | null {
  if (user.isSuperAdmin) return "owner";
  if (project.manager?.toString() === user.id) return "owner";
  if ((project.team ?? []).some((m) => m.user.toString() === user.id)) return "member";
  return null;
}

export function canSeeItem(user: Pick<CurrentUser, "id">, role: VaultRole | null, item: Pick<IVaultItem, "audience" | "members" | "createdBy">): boolean {
  if (!role) return false;
  if (role === "owner") return true;
  if (item.createdBy.toString() === user.id) return true;
  return item.audience === "team" || item.members.some((m) => m.toString() === user.id);
}

export function canManageItem(user: Pick<CurrentUser, "id">, role: VaultRole | null, item: Pick<IVaultItem, "createdBy">): boolean {
  if (!role) return false;
  return role === "owner" || item.createdBy.toString() === user.id;
}

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

export type VaultPayload =
  | { kind: "env"; entries: EnvEntry[] }
  | { kind: "credential"; url?: string; username?: string; password: string; notes?: string }
  | { kind: "note"; content: string };

/** The payload as ordered key / value fields (env variables, or url / username / password / notes, or content). */
export function payloadFields(payload: VaultPayload): EnvEntry[] {
  if (payload.kind === "env") return payload.entries;
  if (payload.kind === "note") return [{ key: "content", value: payload.content }];
  const out: EnvEntry[] = [];
  if (payload.url) out.push({ key: "url", value: payload.url });
  if (payload.username) out.push({ key: "username", value: payload.username });
  out.push({ key: "password", value: payload.password });
  if (payload.notes) out.push({ key: "notes", value: payload.notes });
  return out;
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

/**
 * The project's data key. Created on first use when `create` is set. A key wrapped with the previous
 * master key (VAULT_MASTER_KEY_PREVIOUS) is transparently re-wrapped with the current one.
 */
export async function projectDataKey(projectId: ObjectId | string, create: boolean): Promise<Buffer | null> {
  await connectDB();
  const pid = projectId.toString();
  const master = currentMasterKey();
  let vault = await ProjectVault.findOne({ project: pid });
  if (!vault) {
    if (!create) return null;
    const dek = newDataKey();
    try {
      await ProjectVault.create({ project: pid, wrappedKey: wrapDataKey(master, dek, pid), masterKeyId: master.id });
      return dek;
    } catch (error) {
      // Another request created it first (unique index) — use theirs.
      if ((error as { code?: number })?.code !== 11000) throw error;
      vault = await ProjectVault.findOne({ project: pid });
      if (!vault) throw error;
    }
  }
  if (vault.masterKeyId === master.id) return unwrapDataKey(master, vault.wrappedKey, pid);
  const previous = previousMasterKey();
  if (previous && vault.masterKeyId === previous.id) {
    const dek = unwrapDataKey(previous, vault.wrappedKey, pid);
    vault.wrappedKey = wrapDataKey(master, dek, pid);
    vault.masterKeyId = master.id;
    await vault.save();
    return dek;
  }
  throw new VaultKeyError("This project's secrets were encrypted with a different master key. Restore the original VAULT_MASTER_KEY (or set it as VAULT_MASTER_KEY_PREVIOUS).");
}

export function sealPayload(dek: Buffer, projectId: Id, itemId: Id, payload: VaultPayload): string {
  return seal(dek, JSON.stringify(payload), itemAad(projectId.toString(), itemId.toString(), payload.kind));
}

export function openPayload(dek: Buffer, item: { _id: Id; project: Id; kind: VaultKind; ciphertext: string }): VaultPayload {
  const parsed = JSON.parse(unseal(dek, item.ciphertext, itemAad(item.project.toString(), item._id.toString(), item.kind))) as VaultPayload;
  if (parsed.kind !== item.kind) throw new VaultKeyError("Secret payload does not match its record.");
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Access log, rotation advice, shredding                              */
/* ------------------------------------------------------------------ */

export async function logVaultEvent(
  user: Pick<CurrentUser, "_id" | "name">,
  input: { project: Id; item?: Id; itemName: string; action: VaultEventAction; field?: string },
): Promise<void> {
  const meta = await requestMeta().catch(() => ({ ip: undefined, userAgent: undefined }));
  await VaultEvent.create({
    project: input.project.toString(),
    item: input.item?.toString(),
    itemName: input.itemName,
    field: input.field,
    action: input.action,
    user: user._id,
    userName: user.name,
    ip: meta.ip,
    userAgent: meta.userAgent,
    at: new Date(),
  });
}

/** Reveal-type events — counted for rate limiting and used to find who has seen a secret. */
export const REVEAL_ACTIONS: VaultEventAction[] = ["reveal", "copy", "download", "edit_open"];

/**
 * Called when people lose access to a project's vault (removed from the team / no longer manager / demoted to
 * member / left the company): drops them from per-item audiences and flags every item they revealed, created or
 * updated so the owners rotate it.
 */
export async function adviseRotationForRemoved(projectId: Id, userIds: string[], reason: string): Promise<number> {
  if (userIds.length === 0) return 0;
  await connectDB();
  const pid = projectId.toString();
  await VaultItem.updateMany({ project: pid }, { $pull: { members: { $in: userIds } } });
  const [seen, authored] = await Promise.all([
    VaultEvent.distinct("item", { project: pid, user: { $in: userIds }, action: { $in: [...REVEAL_ACTIONS, "create", "update"] } }) as Promise<ObjectId[]>,
    VaultItem.find({ project: pid, $or: [{ createdBy: { $in: userIds } }, { updatedBy: { $in: userIds } }] }, { _id: 1 }).lean(),
  ]);
  const ids = [...seen, ...authored.map((i) => i._id)];
  if (ids.length === 0) return 0;
  const res = await VaultItem.updateMany({ _id: { $in: ids } }, { $set: { rotationAdvisedAt: new Date(), rotationAdvisedReason: reason } });
  return res.modifiedCount;
}

/** A person who can no longer sign in (exit, login disabled) loses every vault at once: flag each project they belong to. */
export async function adviseRotationForUser(userId: Id, reason: string): Promise<number> {
  await connectDB();
  const uid = userId.toString();
  const projects = await Project.find({ $or: [{ manager: uid }, { "team.user": uid }] }, { _id: 1 }).lean();
  let flagged = 0;
  for (const p of projects) flagged += await adviseRotationForRemoved(p._id, [uid], reason);
  return flagged;
}

/** Deletes every vault item, access-log entry and the wrapped key of a project (crypto-shred). Returns the number of items shredded. */
export async function shredProjectVault(projectId: Id): Promise<number> {
  await connectDB();
  const pid = projectId.toString();
  const [items] = await Promise.all([VaultItem.deleteMany({ project: pid }), VaultEvent.deleteMany({ project: pid }), ProjectVault.deleteOne({ project: pid })]);
  return items.deletedCount;
}
