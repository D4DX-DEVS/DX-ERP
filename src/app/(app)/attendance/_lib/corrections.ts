import "server-only";
import { ne, type SQL } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { AttendanceCorrection } from "@/lib/models";
import { inList } from "@/lib/sql";
import type { AttendanceAccess } from "./access";

/** Condition for correction requests the viewer may decide: never their own; managers only their direct reports. */
export function decidableFilter(user: CurrentUser, access: AttendanceAccess): SQL {
  if (access.approve) return ne(AttendanceCorrection.user, user._id);
  return inList(
    AttendanceCorrection.user,
    access.reportIds.filter((id) => id !== user.id),
  );
}

/** Condition for the decided-history tab: everything for `attendance.approve`, otherwise direct reports. */
export function historyFilter(access: AttendanceAccess): SQL | undefined {
  return access.approve ? undefined : inList(AttendanceCorrection.user, access.reportIds);
}
