import "server-only";
import type { CurrentUser } from "@/lib/auth/session";
import type { AttendanceAccess } from "./access";

/** Mongo filter for correction requests the viewer may decide: never their own; managers only their direct reports. */
export function decidableFilter(user: CurrentUser, access: AttendanceAccess): Record<string, unknown> {
  if (access.approve) return { user: { $ne: user._id } };
  return { user: { $in: access.reportIds.filter((id) => id !== user.id) } };
}

/** Mongo filter for the decided-history tab: everything for `attendance.approve`, otherwise direct reports. */
export function historyFilter(access: AttendanceAccess): Record<string, unknown> {
  return access.approve ? {} : { user: { $in: access.reportIds } };
}
