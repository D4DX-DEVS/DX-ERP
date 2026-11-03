import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { can, requestMeta, type CurrentUser } from "@/lib/auth/session";
import { Project, ProjectVault, VaultEvent, VaultItem, type Id, type IVaultItem, type VaultEventAction, type VaultKind } from "@/lib/models";
import { inList, isUniqueViolation, jsonHasAny, jsonHasField } from "@/lib/sql";
import { currentMasterKey, itemAad, newDataKey, previousMasterKey, seal, unseal, unwrapDataKey, VaultKeyError, wrapDataKey } from "./crypto";
import type { EnvEntry } from "./dotenv";

/**
 * Who may use a project's vault. Access follows project MEMBERSHIP, not organisation-wide permissions:
 * `projects.view_all` / `projects.manage` holders who are not on the team get nothing. The super admin
 * (single env-configured owner account) keeps break-glass access to every vault.
 *
 *   owner  — the project manager and the super admin: see and manage every item, see the access log
 *   member — team members who can manage the project (`projects.manage`, e.g. team leads): see items shared with
 *            the whole team or with them; add items and manage the ones they created
 *   viewer — every other team member (normal staff): see items shared with the whole team or with them; read-only
 */
export type VaultRole = "owner" | "member" | "viewer";

export function vaultRole(user: Pick<CurrentUser, "id" | "isSuperAdmin" | "permissions">, project: { manager?: Id | null; team?: { user: Id }[] }): VaultRole | null {
  if (user.isSuperAdmin) return "owner";
  if (project.manager === user.id) return "owner";
  if ((project.team ?? []).some((m) => m.user === user.id)) return can(user, "projects.manage") ? "member" : "viewer";
  return null;
}

export function canSeeItem(user: Pick<CurrentUser, "id">, role: VaultRole | null, item: Pick<IVaultItem, "audience" | "members" | "createdBy">): boolean {
  if (!role) return false;
  if (role === "owner") return true;
  if (item.createdBy === user.id) return true;
  return item.audience === "team" || item.members.some((m) => m === user.id);
}

export function canManageItem(user: Pick<CurrentUser, "id">, role: VaultRole | null, item: Pick<IVaultItem, "createdBy">): boolean {
  if (!role) return false;
  return role === "owner" || (role === "member" && item.createdBy === user.id);
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
export async function projectDataKey(projectId: Id, create: boolean): Promise<Buffer | null> {
  const pid = projectId;
  const master = currentMasterKey();
  const findVault = async () => (await db().select().from(ProjectVault).where(eq(ProjectVault.project, pid)).limit(1))[0];
  let vault = await findVault();
  if (!vault) {
    if (!create) return null;
    const dek = newDataKey();
    try {
      await db().insert(ProjectVault).values({ project: pid, wrappedKey: wrapDataKey(master, dek, pid), masterKeyId: master.id });
      return dek;
    } catch (error) {
      // Another request created it first (unique index) — use theirs.
      if (!isUniqueViolation(error)) throw error;
      vault = await findVault();
      if (!vault) throw error;
    }
  }
  if (vault.masterKeyId === master.id) return unwrapDataKey(master, vault.wrappedKey, pid);
  const previous = previousMasterKey();
  if (previous && vault.masterKeyId === previous.id) {
    const dek = unwrapDataKey(previous, vault.wrappedKey, pid);
    await db().update(ProjectVault).set({ wrappedKey: wrapDataKey(master, dek, pid), masterKeyId: master.id }).where(eq(ProjectVault._id, vault._id));
    return dek;
  }
  throw new VaultKeyError("This project's secrets were encrypted with a different master key. Restore the original VAULT_MASTER_KEY (or set it as VAULT_MASTER_KEY_PREVIOUS).");
}

export function sealPayload(dek: Buffer, projectId: Id, itemId: Id, payload: VaultPayload): string {
  return seal(dek, JSON.stringify(payload), itemAad(projectId, itemId, payload.kind));
}

export function openPayload(dek: Buffer, item: { _id: Id; project: Id; kind: VaultKind; ciphertext: string }): VaultPayload {
  const parsed = JSON.parse(unseal(dek, item.ciphertext, itemAad(item.project, item._id, item.kind))) as VaultPayload;
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
  await db().insert(VaultEvent).values({
    project: input.project,
    item: input.item,
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
  return adviseRotation([projectId], userIds, reason);
}

/** `adviseRotationForRemoved` over several projects at once (no per-project queries). */
async function adviseRotation(projectIds: Id[], userIds: string[], reason: string): Promise<number> {
  if (userIds.length === 0 || projectIds.length === 0) return 0;
  // Drop the people from per-item audiences (the `$pull`), in one statement.
  await db()
    .update(VaultItem)
    .set({
      members: sql`(select coalesce(json_group_array(value), json('[]')) from json_each(${VaultItem.members}) where value not in (select value from json_each(${JSON.stringify(userIds)})))`,
    })
    .where(and(inList(VaultItem.project, projectIds), jsonHasAny(VaultItem.members, userIds)));
  const [seen, authored] = await Promise.all([
    db()
      .selectDistinct({ item: VaultEvent.item })
      .from(VaultEvent)
      .where(and(inList(VaultEvent.project, projectIds), inList(VaultEvent.user, userIds), inList(VaultEvent.action, [...REVEAL_ACTIONS, "create", "update"]))),
    db()
      .select({ _id: VaultItem._id })
      .from(VaultItem)
      .where(and(inList(VaultItem.project, projectIds), or(inList(VaultItem.createdBy, userIds), inList(VaultItem.updatedBy, userIds)))),
  ]);
  const ids = [...new Set([...seen.map((e) => e.item).filter((i): i is Id => Boolean(i)), ...authored.map((i) => i._id)])];
  if (ids.length === 0) return 0;
  const flagged = await db()
    .update(VaultItem)
    .set({ rotationAdvisedAt: new Date(), rotationAdvisedReason: reason })
    .where(inList(VaultItem._id, ids))
    .returning({ id: VaultItem._id });
  return flagged.length;
}

/** A person who can no longer sign in (exit, login disabled) loses every vault at once: flag each project they belong to. */
export async function adviseRotationForUser(userId: Id, reason: string): Promise<number> {
  const uid = userId;
  const projects = await db()
    .select({ id: Project._id })
    .from(Project)
    .where(or(eq(Project.manager, uid), jsonHasField(Project.team, "user", uid)));
  return adviseRotation(projects.map((p) => p.id), [uid], reason);
}

/** Deletes every vault item, access-log entry and the wrapped key of a project (crypto-shred). Returns the number of items shredded. */
export async function shredProjectVault(projectId: Id): Promise<number> {
  const pid = projectId;
  // One atomic batch: either the whole vault is shredded or nothing is.
  const [items] = await db().batch([
    db().delete(VaultItem).where(eq(VaultItem.project, pid)).returning({ id: VaultItem._id }),
    db().delete(VaultEvent).where(eq(VaultEvent.project, pid)),
    db().delete(ProjectVault).where(eq(ProjectVault.project, pid)),
  ]);
  return items.length;
}
