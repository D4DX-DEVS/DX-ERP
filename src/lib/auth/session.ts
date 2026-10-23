import "server-only";
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect, forbidden } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { Department, Designation, Role, Session, User, type Id, type IUser } from "@/lib/models";
import { effectivePermissions } from "@/lib/rbac/roles";
import { ROLE_LABELS, type Permission } from "@/lib/rbac/permissions";
import { SESSION_COOKIE, signToken, verifyToken, type SessionClaims } from "@/lib/auth/token";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";

export interface CurrentUser {
  id: string;
  _id: Id;
  sid: string;
  name: string;
  email: string;
  employeeId: string;
  photo?: string;
  role: string;
  roleName: string;
  personType: IUser["personType"];
  isSuperAdmin: boolean;
  departmentId?: string;
  departmentName?: string;
  designationName?: string;
  reportingManagerId?: string;
  permissions: Permission[];
}

const EXITED_STATUSES = new Set(["resigned", "terminated", "inactive"]);

export async function requestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) || undefined };
}

/** Creates a DB-backed session and sets the signed session cookie. */
export async function createSession(userId: Id, method: "google" | "password", remember: boolean): Promise<void> {
  const settings = await getSettings();
  const ttlMs = remember ? settings.security.rememberDays * 86_400_000 : settings.security.sessionHours * 3_600_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const sid = randomBytes(24).toString("base64url");
  const meta = await requestMeta();
  await db().insert(Session).values({ sid, user: userId, expiresAt, method, ip: meta.ip, userAgent: meta.userAgent });
  const token = await signToken({ sid, uid: userId } satisfies SessionClaims, expiresAt);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: remember ? expiresAt : undefined,
  });
  await db().update(User).set({ lastLoginAt: new Date() }).where(eq(User._id, userId));
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const claims = await verifyToken<SessionClaims & Record<string, unknown>>(jar.get(SESSION_COOKIE)?.value);
  if (claims?.sid) {
    await db().update(Session).set({ revokedAt: new Date(), revokedReason: "logout" }).where(eq(Session.sid, claims.sid));
  }
  jar.delete(SESSION_COOKIE);
}

/** Revokes every active session of a user (deactivation, role change, forced sign-out). */
export async function revokeUserSessions(userId: Id, reason: string): Promise<void> {
  await db()
    .update(Session)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(Session.user, userId), isNull(Session.revokedAt)));
}

/** Resolves the signed-in user for this request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const claims = await verifyToken<SessionClaims & Record<string, unknown>>(jar.get(SESSION_COOKIE)?.value);
  if (!claims?.sid || !claims.uid) return null;

  // One query: session + user + role/department/designation names (D1 counts every round trip).
  const [row] = await db()
    .select({
      sessionId: Session._id,
      lastSeenAt: Session.lastSeenAt,
      _id: User._id,
      name: User.name,
      email: User.email,
      employeeId: User.employeeId,
      photo: User.photo,
      role: User.role,
      personType: User.personType,
      isSuperAdmin: User.isSuperAdmin,
      department: User.department,
      reportingManager: User.reportingManager,
      accountActive: User.accountActive,
      status: User.status,
      roleName: Role.name,
      rolePermissions: Role.permissions,
      departmentName: Department.name,
      designationName: Designation.name,
    })
    .from(Session)
    .innerJoin(User, eq(User._id, Session.user))
    .leftJoin(Role, eq(Role.key, User.role))
    .leftJoin(Department, eq(Department._id, User.department))
    .leftJoin(Designation, eq(Designation._id, User.designation))
    .where(and(eq(Session.sid, claims.sid), isNull(Session.revokedAt), gt(Session.expiresAt, new Date()), eq(Session.user, claims.uid)))
    .limit(1);
  if (!row) return null;
  const user = row;
  if (!user.isSuperAdmin && (!user.accountActive || EXITED_STATUSES.has(user.status))) return null;

  if (Date.now() - user.lastSeenAt.getTime() > 5 * 60_000) {
    await db().update(Session).set({ lastSeenAt: new Date() }).where(eq(Session._id, user.sessionId));
  }

  const permissions = effectivePermissions(user.isSuperAdmin ? "super_admin" : user.role, user.rolePermissions);

  return {
    id: user._id,
    _id: user._id,
    sid: claims.sid,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
    photo: user.photo ?? undefined,
    role: user.isSuperAdmin ? "super_admin" : user.role,
    roleName: user.isSuperAdmin ? ROLE_LABELS.super_admin : user.roleName ?? ROLE_LABELS[user.role] ?? user.role,
    personType: user.personType,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    departmentId: user.department ?? undefined,
    departmentName: user.departmentName ?? undefined,
    designationName: user.designationName ?? undefined,
    reportingManagerId: user.reportingManager ?? undefined,
    permissions,
  };
});

/** For pages/layouts: redirects to /login when not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function can(user: Pick<CurrentUser, "isSuperAdmin" | "permissions"> | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return user.isSuperAdmin || user.permissions.includes(permission);
}

export function canAny(user: Pick<CurrentUser, "isSuperAdmin" | "permissions"> | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}

/** For pages: renders the 403 page when the permission is missing. */
export async function requirePagePermission(...permissions: Permission[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (permissions.length && !canAny(user, permissions)) forbidden();
  return user;
}

/** True when the person is a regular staff member who records attendance (not the super admin account). */
export function isStaff(user: Pick<CurrentUser, "personType">): boolean {
  return user.personType !== "admin";
}

export function isInternLike(user: Pick<CurrentUser, "personType">): boolean {
  return user.personType === "intern" || user.personType === "trainee";
}
