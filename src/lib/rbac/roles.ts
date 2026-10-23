import "server-only";
import { connectDB } from "@/lib/db";
import { Role } from "@/lib/models";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  isPermission,
  type Permission,
} from "@/lib/rbac/permissions";

/** Creates any missing built-in roles with their default permissions (idempotent). */
export async function ensureRoles(): Promise<void> {
  await connectDB();
  const existing = new Set((await Role.find({}, { key: 1 }).lean()).map((r) => r.key));
  const missing = ROLE_KEYS.filter((k) => !existing.has(k));
  if (missing.length === 0) return;
  await Role.insertMany(
    missing.map((key) => ({
      key,
      name: ROLE_LABELS[key],
      description: ROLE_DESCRIPTIONS[key],
      permissions: DEFAULT_ROLE_PERMISSIONS[key],
      system: true,
    })),
    { ordered: false },
  ).catch(() => undefined);
}

/** Effective permissions for a role key. Super admin always has everything. */
export async function permissionsForRole(roleKey: string): Promise<Permission[]> {
  if (roleKey === "super_admin") return ALL_PERMISSIONS;
  await connectDB();
  const role = await Role.findOne({ key: roleKey }, { permissions: 1 }).lean();
  if (!role) {
    const fallback = DEFAULT_ROLE_PERMISSIONS[roleKey as keyof typeof DEFAULT_ROLE_PERMISSIONS];
    return fallback ?? [];
  }
  return role.permissions.filter(isPermission);
}

/** Roles that can be assigned to staff (everything except the reserved super admin role). */
export async function assignableRoles(): Promise<{ key: string; name: string }[]> {
  await connectDB();
  const roles = await Role.find({ key: { $ne: "super_admin" } }, { key: 1, name: 1 }).sort({ system: -1, name: 1 }).lean();
  if (roles.length === 0) {
    return ROLE_KEYS.filter((k) => k !== "super_admin").map((k) => ({ key: k, name: ROLE_LABELS[k] }));
  }
  return roles.map((r) => ({ key: r.key, name: r.name }));
}
