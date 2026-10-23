import "server-only";
import type { Types } from "mongoose";
import { can, canAny, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { User, type IMovement } from "@/lib/models";
import { directReportIds } from "@/lib/people";
import type { AppSettings, MovementCategory } from "@/lib/config-defaults";

/**
 * Movement register visibility (FRS §8, §3.2):
 * - everyone sees their own movements;
 * - reporting managers see (and approve) their direct reports' movements;
 * - `movement.view_all` opens the organisation-wide register;
 * - details of personal (non-official) movements are restricted to the person, their manager
 *   and `movement.view_personal`.
 */
export type MovementScope = { kind: "all" } | { kind: "team"; userIds: string[] } | { kind: "self" };

export async function movementScope(user: CurrentUser): Promise<MovementScope> {
  if (canAny(user, ["movement.view_all", "movement.approve", "movement.manage"])) return { kind: "all" };
  const reports = await directReportIds(user._id);
  if (reports.length > 0) return { kind: "team", userIds: [user.id, ...reports] };
  return { kind: "self" };
}

export function scopeFilter(user: CurrentUser, scope: MovementScope): Record<string, unknown> {
  if (scope.kind === "all") return {};
  if (scope.kind === "team") return { user: { $in: scope.userIds } };
  return { user: user._id };
}

/** Manager (or intern mentor) relationship check. */
export async function managesUser(managerId: string, userId: string | Types.ObjectId): Promise<boolean> {
  await connectDB();
  const u = await User.findById(userId, { reportingManager: 1 }).lean();
  return u?.reportingManager?.toString() === managerId;
}

export async function canViewMovement(user: CurrentUser, m: Pick<IMovement, "user">): Promise<boolean> {
  if (m.user.toString() === user.id) return true;
  if (canAny(user, ["movement.view_all", "movement.approve", "movement.manage"])) return true;
  return managesUser(user.id, m.user);
}

/** Approvers: the person's CURRENT reporting manager or anyone with `movement.approve` — never the person themself (a former manager stored as `approver` no longer counts). */
export async function canApproveMovement(user: CurrentUser, m: Pick<IMovement, "user" | "approver">): Promise<boolean> {
  if (m.user.toString() === user.id) return false;
  if (can(user, "movement.approve")) return true;
  return managesUser(user.id, m.user);
}

/** Whether the viewer may read purpose / destination / remarks of a personal movement. */
export function personalDetailsVisible(user: CurrentUser, m: Pick<IMovement, "user" | "official">, isManager: boolean): boolean {
  if (m.official) return true;
  if (m.user.toString() === user.id) return true;
  if (can(user, "movement.view_personal")) return true;
  return isManager;
}

export function categoryOf(settings: AppSettings, key: string): MovementCategory | undefined {
  return settings.movement.categories.find((c) => c.key === key);
}

/** Overdue = still out and past expected return plus the configured grace. */
export function isOverdue(m: Pick<IMovement, "status" | "expectedReturn">, settings: AppSettings, now = new Date()): boolean {
  if (m.status !== "out" || !m.expectedReturn) return false;
  return now.getTime() > new Date(m.expectedReturn).getTime() + settings.movement.overdueGraceMinutes * 60_000;
}

/** Instant before which an open movement's expected return counts as overdue. */
export function overdueCutoff(settings: AppSettings, now = new Date()): Date {
  return new Date(now.getTime() - settings.movement.overdueGraceMinutes * 60_000);
}

/** Minutes after Out-Time during which the person may still cancel a movement they recorded by mistake. */
export const SELF_CANCEL_MINUTES = 15;

/**
 * Later cancellations go through a correction request or `movement.manage`: cancelling after returning would
 * drop the time outside from the attendance calculation (only `returned` movements are deducted).
 */
export function withinSelfCancelWindow(m: Pick<IMovement, "outTime">, now = new Date()): boolean {
  return Boolean(m.outTime) && now.getTime() - new Date(m.outTime!).getTime() <= SELF_CANCEL_MINUTES * 60_000;
}

/** Missing In-Time = still out on a movement that started on an earlier day. */
export function isMissingInTime(m: Pick<IMovement, "status" | "date">, today: string): boolean {
  return m.status === "out" && m.date < today;
}

/** Display status combining movement status with overdue / missing In-Time flags. */
export function displayStatus(m: Pick<IMovement, "status" | "expectedReturn" | "date">, settings: AppSettings, today: string): "out" | "overdue" | "missing_in" | "returned" | "cancelled" | "draft" {
  if (m.status === "out") {
    if (isMissingInTime(m, today)) return "missing_in";
    if (isOverdue(m, settings)) return "overdue";
  }
  return m.status;
}
