"use server";

import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { revokeUserSessions } from "@/lib/auth/session";
import { escapeRegex } from "@/lib/format";
import { Role, User } from "@/lib/models";
import { notify } from "@/lib/notify";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_LABELS,
  ROLE_KEYS,
  isPermission,
  type Permission,
  type RoleKey,
} from "@/lib/rbac/permissions";
import { getSettings } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { isObjectId, zs } from "@/lib/validation";
import { adviseRotationForUser } from "@/lib/vault/service";

function fieldError(field: string, message: string): never {
  throw new ActionError(message, { [field]: message });
}

function clip(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Catalogue-ordered, de-duplicated list of valid permissions. */
function cleanPermissions(input: unknown): Permission[] {
  const wanted = new Set(Array.isArray(input) ? input.map(String) : []);
  return ALL_PERMISSIONS.filter((p) => wanted.has(p));
}

function permissionChanges(before: string[], after: Permission[]) {
  const b = new Set(before);
  const a = new Set<string>(after);
  const added = after.filter((p) => !b.has(p));
  const removed = before.filter((p) => isPermission(p) && !a.has(p));
  const changes = [
    ...added.map((p) => ({ field: `${PERMISSION_LABELS[p]} (${p})`, from: "Not allowed", to: "Allowed" })),
    ...removed.map((p) => ({ field: `${PERMISSION_LABELS[p as Permission]} (${p})`, from: "Allowed", to: "Not allowed" })),
  ];
  return { added, removed, changes };
}

function summarizePermissions(roleName: string, added: string[], removed: string[]): string {
  const parts: string[] = [];
  if (added.length) parts.push(`granted ${clip(added.join(", "), 140)}`);
  if (removed.length) parts.push(`revoked ${clip(removed.join(", "), 140)}`);
  return `Changed permissions of role ${roleName}: ${parts.join("; ")}`;
}

/**
 * Privilege ceiling for delegated administrators (anyone with roles.manage / users.manage who is not the
 * super admin): they can't edit their own role and can only grant permissions they hold themselves.
 */
function assertCanGrant(actor: { isSuperAdmin: boolean; role: string; permissions: Permission[] }, roleKey: string, added: Permission[]): void {
  if (actor.isSuperAdmin) return;
  if (actor.role === roleKey) throw new ActionError("You can't change the permissions of your own role. Ask the super admin.");
  const own = new Set<string>(actor.permissions);
  const beyond = added.filter((p) => !own.has(p));
  if (beyond.length) throw new ActionError(`You can only grant permissions you hold yourself. Not allowed: ${clip(beyond.join(", "), 160)}.`);
}

/** Role keys arrive from the client: accept only plain slugs (blocks `{ $ne: … }`-style query objects). */
function assertRoleKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !/^[a-z][a-z0-9_]{1,30}$/.test(key)) throw new ActionError("Role not found");
}

/* ───────────────────────────── Roles ───────────────────────────── */

export async function saveRolePermissions(key: string, permissions: string[]): Promise<ActionResult<{ changed: number }>> {
  return runAction(async () => {
    const user = await actionPermission("roles.manage");
    assertRoleKey(key);
    if (key === "super_admin") throw new ActionError("The super admin role always has every permission and can't be edited.");
    const role = await Role.findOne({ key }).lean();
    if (!role) throw new ActionError("Role not found");
    const next = cleanPermissions(permissions);
    const { added, removed, changes } = permissionChanges(role.permissions, next);
    if (changes.length === 0) return { changed: 0 };
    assertCanGrant(user, key, added);
    await Role.updateOne({ key }, { $set: { permissions: next } });
    await audit(user, { action: "access", entity: "role", entityId: role._id, ref: role.key, summary: summarizePermissions(role.name, added, removed), changes });
    return { changed: changes.length };
  }, "Permissions saved");
}

export async function resetRolePermissions(key: string): Promise<ActionResult<{ changed: number }>> {
  return runAction(async () => {
    const user = await actionPermission("roles.manage");
    assertRoleKey(key);
    if (!(ROLE_KEYS as readonly string[]).includes(key) || key === "super_admin") throw new ActionError("Only built-in roles can be reset to their defaults.");
    const role = await Role.findOne({ key }).lean();
    if (!role) throw new ActionError("Role not found");
    const next = [...DEFAULT_ROLE_PERMISSIONS[key as RoleKey]];
    const { added, removed, changes } = permissionChanges(role.permissions, next);
    if (changes.length === 0) return { changed: 0 };
    assertCanGrant(user, key, added);
    await Role.updateOne({ key }, { $set: { permissions: next } });
    await audit(user, { action: "access", entity: "role", entityId: role._id, ref: role.key, summary: `Reset role ${role.name} to defaults · ${summarizePermissions(role.name, added, removed).split(": ")[1]}`, changes });
    return { changed: changes.length };
  }, "Role reset to defaults");
}

const createRoleSchema = z.object({
  key: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string({ error: "Key is required" }).regex(/^[a-z][a-z0-9_]{1,30}$/, "Use 2–31 lowercase letters, digits or underscores, starting with a letter"),
  ),
  name: zs.text("Name", 60),
  description: zs.optText(300),
  copyFrom: zs.optText(60),
});

export async function createRole(input: Record<string, unknown>): Promise<ActionResult<{ key: string }>> {
  return runAction(async () => {
    const user = await actionPermission("roles.manage");
    const data = parse(createRoleSchema, input);
    if ((ROLE_KEYS as readonly string[]).includes(data.key)) fieldError("key", "This key is reserved for a built-in role");
    if (await Role.exists({ key: data.key })) fieldError("key", "A role with this key already exists");
    if (await Role.exists({ name: new RegExp(`^${escapeRegex(data.name)}$`, "i") })) fieldError("name", "A role with this name already exists");

    let permissions: Permission[] = [];
    let copiedFrom: string | undefined;
    if (data.copyFrom) {
      if (data.copyFrom === "super_admin") fieldError("copyFrom", "Permissions can't be copied from the super admin role");
      const source = await Role.findOne({ key: data.copyFrom }).lean();
      if (!source) fieldError("copyFrom", "Role not found");
      permissions = cleanPermissions(source.permissions);
      if (!user.isSuperAdmin && permissions.some((p) => !user.permissions.includes(p))) fieldError("copyFrom", "That role has permissions you don't hold, so you can't copy it");
      copiedFrom = source.name;
    }
    const role = await Role.create({ key: data.key, name: data.name, description: data.description, permissions, system: false });
    await audit(user, {
      action: "access",
      entity: "role",
      entityId: role._id,
      ref: role.key,
      summary: `Created role ${role.name}${copiedFrom ? ` with permissions copied from ${copiedFrom}` : " with no permissions"} (${permissions.length} granted)`,
    });
    return { key: role.key };
  }, "Role created");
}

const roleDetailsSchema = z.object({ key: zs.text("Role", 60), name: zs.text("Name", 60), description: zs.optText(300) });

export async function updateRoleDetails(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("roles.manage");
    const data = parse(roleDetailsSchema, input);
    const role = await Role.findOne({ key: data.key }).lean();
    if (!role) throw new ActionError("Role not found");
    if (role.system) throw new ActionError("Built-in roles can't be renamed.");
    if (await Role.exists({ key: { $ne: data.key }, name: new RegExp(`^${escapeRegex(data.name)}$`, "i") })) fieldError("name", "A role with this name already exists");
    await Role.updateOne({ key: data.key }, { $set: { name: data.name, description: data.description ?? "" } });
    const changes = diff({ name: role.name, description: role.description }, { name: data.name, description: data.description }, ["name", "description"]);
    if (changes.length) await audit(user, { action: "access", entity: "role", entityId: role._id, ref: role.key, summary: `Updated details of role ${data.name}`, changes });
    return null;
  }, "Role updated");
}

export async function deleteRole(key: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("roles.manage");
    assertRoleKey(key);
    const role = await Role.findOne({ key }).lean();
    if (!role) throw new ActionError("Role not found");
    if (role.system) throw new ActionError("Built-in roles can't be deleted. Use “Reset to defaults” instead.");
    const people = await User.countDocuments({ role: key });
    if (people > 0) throw new ActionError(`${people} ${people === 1 ? "person has" : "people have"} this role. Move them to another role first.`);
    await Role.deleteOne({ key });
    await audit(user, { action: "access", entity: "role", entityId: role._id, ref: role.key, summary: `Deleted role ${role.name}` });
    return null;
  }, "Role deleted");
}

/* ───────────────────────────── Users ───────────────────────────── */

async function loadTarget(id: string, actorId: string) {
  if (!isObjectId(id)) throw new ActionError("Person not found");
  const target = await User.findById(id, { name: 1, role: 1, isSuperAdmin: 1, accountActive: 1, personType: 1, employeeId: 1 }).lean();
  if (!target) throw new ActionError("Person not found");
  if (target.isSuperAdmin || target.personType === "admin") throw new ActionError("The super admin is configured through server environment variables and can't be changed here.");
  if (target._id.toString() === actorId) throw new ActionError("You can't change your own role or access. Ask another administrator.");
  return target;
}

const changeRoleSchema = z.object({ id: zs.id("Person"), role: zs.text("Role", 60) });

export async function changeUserRole(input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionPermission("users.manage");
    const data = parse(changeRoleSchema, input);
    const target = await loadTarget(data.id, actor.id);
    if (data.role === "super_admin") fieldError("role", "The super admin role can't be assigned");
    const [next, current] = await Promise.all([Role.findOne({ key: data.role }, { name: 1, permissions: 1 }).lean(), Role.findOne({ key: target.role }, { name: 1, permissions: 1 }).lean()]);
    if (!next) fieldError("role", "Role not found");
    if (!actor.isSuperAdmin) {
      // Delegated admins can't hand out — or take away — more power than they hold.
      const own = new Set<string>(actor.permissions);
      if (next.permissions.some((p) => !own.has(p))) fieldError("role", "This role has permissions you don't hold, so you can't assign it");
      if (current?.permissions.some((p) => !own.has(p))) fieldError("role", `${target.name}'s current role has permissions you don't hold. Ask the super admin.`);
    }
    if (target.role === data.role) fieldError("role", `${target.name} already has this role`);
    const fromName = current?.name ?? target.role;

    await User.updateOne(
      { _id: target._id },
      {
        $set: { role: data.role },
        $push: { history: { type: "role_change", date: todayKey(), summary: `Role changed from ${fromName} to ${next.name}`, from: fromName, to: next.name, by: actor._id, byName: actor.name, at: new Date() } },
      },
    );
    await revokeUserSessions(target._id, "role_change");
    await audit(actor, {
      action: "access",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `Changed role of ${target.name} from ${fromName} to ${next.name}; sessions revoked`,
      changes: [{ field: "role", from: fromName, to: next.name }],
    });
    await notify([target._id], { type: "system", title: "Your role was changed", body: `You now have the ${next.name} role. You were signed out; sign in again to continue.`, link: "/dashboard", priority: "high" });
    return null;
  }, "Role updated and sessions revoked");
}

export async function setLoginAccess(id: string, enabled: boolean): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await actionPermission("users.manage");
    const target = await loadTarget(id, actor.id);
    if (target.accountActive === enabled) throw new ActionError(`Login access is already ${enabled ? "enabled" : "disabled"} for ${target.name}.`);
    if (!actor.isSuperAdmin) {
      // Delegated admins can't switch off (or on) people whose role carries permissions they don't hold.
      const current = await Role.findOne({ key: target.role }, { permissions: 1 }).lean();
      const own = new Set<string>(actor.permissions);
      if (current?.permissions.some((p) => !own.has(p))) throw new ActionError(`${target.name}'s role has permissions you don't hold. Ask the super admin.`);
    }
    if (enabled) {
      const full = await User.findById(target._id, { status: 1 }).lean();
      const settings = await getSettings();
      const status = full?.status ?? "";
      if (["resigned", "terminated", "inactive"].includes(status) || settings.employmentStatuses.find((s) => s.key === status)?.category === "exited") {
        throw new ActionError("Change the employment status first — people who have left can't sign in.");
      }
    }
    const summary = enabled ? "Login access enabled" : "Login access disabled";
    await User.updateOne(
      { _id: target._id },
      {
        $set: { accountActive: enabled },
        $push: { history: { type: "access_change", date: todayKey(), summary, from: enabled ? "No access" : "Login enabled", to: enabled ? "Login enabled" : "No access", by: actor._id, byName: actor.name, at: new Date() } },
      },
    );
    await revokeUserSessions(target._id, enabled ? "access_enabled" : "access_disabled");
    if (!enabled) await adviseRotationForUser(target._id, `${target.name}'s login access was disabled after they accessed it`);
    await audit(actor, {
      action: "access",
      entity: "user",
      entityId: target._id,
      ref: target.employeeId,
      summary: `${summary} for ${target.name}; sessions revoked`,
      changes: [{ field: "accountActive", from: String(!enabled), to: String(enabled) }],
    });
    await notify([target._id], {
      type: "system",
      title: enabled ? "Sign-in access enabled" : "Sign-in access disabled",
      body: enabled ? "You can sign in to the ERP again." : "Your access to the ERP was disabled. Contact an administrator if this is unexpected.",
      priority: "high",
    });
    return null;
  }, "Login access updated");
}
