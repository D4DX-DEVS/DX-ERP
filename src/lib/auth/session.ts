import "server-only";
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect, forbidden } from "next/navigation";
import { connectDB } from "@/lib/db";
import { Department, Designation, Role, Session, User, type IUser } from "@/lib/models";
import { permissionsForRole } from "@/lib/rbac/roles";
import { ROLE_LABELS, type Permission } from "@/lib/rbac/permissions";
import { SESSION_COOKIE, signToken, verifyToken, type SessionClaims } from "@/lib/auth/token";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import type { Types } from "mongoose";

export interface CurrentUser {
  id: string;
  _id: Types.ObjectId;
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
export async function createSession(userId: Types.ObjectId, method: "google" | "password", remember: boolean): Promise<void> {
  await connectDB();
  const settings = await getSettings();
  const ttlMs = remember ? settings.security.rememberDays * 86_400_000 : settings.security.sessionHours * 3_600_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const sid = randomBytes(24).toString("base64url");
  const meta = await requestMeta();
  await Session.create({ sid, user: userId, expiresAt, method, ip: meta.ip, userAgent: meta.userAgent });
  const token = await signToken({ sid, uid: userId.toString() } satisfies SessionClaims, expiresAt);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    expires: remember ? expiresAt : undefined,
  });
  await User.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const claims = await verifyToken<SessionClaims & Record<string, unknown>>(jar.get(SESSION_COOKIE)?.value);
  if (claims?.sid) {
    await connectDB();
    await Session.updateOne({ sid: claims.sid }, { $set: { revokedAt: new Date(), revokedReason: "logout" } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Revokes every active session of a user (deactivation, role change, forced sign-out). */
export async function revokeUserSessions(userId: string | Types.ObjectId, reason: string): Promise<void> {
  await connectDB();
  await Session.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

/** Resolves the signed-in user for this request (memoised per request). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const claims = await verifyToken<SessionClaims & Record<string, unknown>>(jar.get(SESSION_COOKIE)?.value);
  if (!claims?.sid || !claims.uid) return null;

  await connectDB();
  const session = await Session.findOne({ sid: claims.sid, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!session || session.user.toString() !== claims.uid) return null;

  const user = await User.findById(claims.uid, {
    name: 1,
    email: 1,
    employeeId: 1,
    photo: 1,
    role: 1,
    personType: 1,
    isSuperAdmin: 1,
    department: 1,
    designation: 1,
    reportingManager: 1,
    accountActive: 1,
    status: 1,
  }).lean();
  if (!user) return null;
  if (!user.isSuperAdmin && (!user.accountActive || EXITED_STATUSES.has(user.status))) return null;

  if (Date.now() - new Date(session.lastSeenAt).getTime() > 5 * 60_000) {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  }

  const [permissions, role, department, designation] = await Promise.all([
    permissionsForRole(user.isSuperAdmin ? "super_admin" : user.role),
    user.isSuperAdmin ? null : Role.findOne({ key: user.role }, { name: 1 }).lean(),
    user.department ? Department.findById(user.department, { name: 1 }).lean() : null,
    user.designation ? Designation.findById(user.designation, { name: 1 }).lean() : null,
  ]);

  return {
    id: user._id.toString(),
    _id: user._id,
    sid: claims.sid,
    name: user.name,
    email: user.email,
    employeeId: user.employeeId,
    photo: user.photo,
    role: user.isSuperAdmin ? "super_admin" : user.role,
    roleName: user.isSuperAdmin ? ROLE_LABELS.super_admin : role?.name ?? ROLE_LABELS[user.role] ?? user.role,
    personType: user.personType,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    departmentId: user.department?.toString(),
    departmentName: department?.name,
    designationName: designation?.name,
    reportingManagerId: user.reportingManager?.toString(),
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
