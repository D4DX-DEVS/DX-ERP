import "server-only";
import { asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
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
  const existing = new Set((await db().select({ key: Role.key }).from(Role)).map((r) => r.key));
  const missing = ROLE_KEYS.filter((k) => !existing.has(k));
  if (missing.length === 0) return;
  for (const key of missing) {
    await db()
      .insert(Role)
      .values({ key, name: ROLE_LABELS[key], description: ROLE_DESCRIPTIONS[key], permissions: DEFAULT_ROLE_PERMISSIONS[key], system: true })
      .onConflictDoNothing();
  }
}

/**
 * Effective permissions for a role key given its stored permission list (`null` when the role row is
 * missing, which falls back to the built-in defaults). Super admin always has everything.
 */
export function effectivePermissions(roleKey: string, stored: string[] | null | undefined): Permission[] {
  if (roleKey === "super_admin") return ALL_PERMISSIONS;
  if (!stored) return DEFAULT_ROLE_PERMISSIONS[roleKey as keyof typeof DEFAULT_ROLE_PERMISSIONS] ?? [];
  return stored.filter(isPermission);
}

/** Effective permissions for a role key. Super admin always has everything. */
export async function permissionsForRole(roleKey: string): Promise<Permission[]> {
  if (roleKey === "super_admin") return ALL_PERMISSIONS;
  const [role] = await db().select({ permissions: Role.permissions }).from(Role).where(eq(Role.key, roleKey)).limit(1);
  return effectivePermissions(roleKey, role?.permissions ?? null);
}

/** Roles that can be assigned to staff (everything except the reserved super admin role). */
export async function assignableRoles(): Promise<{ key: string; name: string }[]> {
  const roles = await db()
    .select({ key: Role.key, name: Role.name })
    .from(Role)
    .where(ne(Role.key, "super_admin"))
    .orderBy(desc(Role.system), asc(Role.name));
  if (roles.length === 0) {
    return ROLE_KEYS.filter((k) => k !== "super_admin").map((k) => ({ key: k, name: ROLE_LABELS[k] }));
  }
  return roles;
}
