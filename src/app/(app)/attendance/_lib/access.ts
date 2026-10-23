import "server-only";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import type { PersonType } from "@/lib/models";
import { directReportIds, EXITED_STATUSES } from "@/lib/people";

/** Person types that record attendance (the super admin account does not). */
export const STAFF_TYPES: PersonType[] = ["employee", "trainee", "intern"];
export { EXITED_STATUSES };

export interface AttendanceAccess {
  /** Records their own attendance (everyone except the super admin account). */
  staff: boolean;
  viewAll: boolean;
  manage: boolean;
  approve: boolean;
  /** Direct reports (reporting-manager relationship). */
  reportIds: string[];
  isManager: boolean;
  /** May open the team register / summary (everyone, or just their reports). */
  canViewTeam: boolean;
  /** May open the corrections queue. */
  canDecide: boolean;
}

export async function attendanceAccess(user: CurrentUser): Promise<AttendanceAccess> {
  const reportIds = await directReportIds(user._id);
  const viewAll = can(user, "attendance.view_all");
  const approve = can(user, "attendance.approve");
  const isManager = reportIds.length > 0;
  return {
    staff: isStaff(user),
    viewAll,
    manage: can(user, "attendance.manage"),
    approve,
    reportIds,
    isManager,
    canViewTeam: viewAll || isManager,
    canDecide: approve || isManager,
  };
}
