import "server-only";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { directReportIds } from "@/lib/people";

export interface LeaveAccess {
  /** Applies for leave themselves (everyone except the super admin account). */
  staff: boolean;
  viewAll: boolean;
  /** HR / management approval (`leave.approve`). */
  approve: boolean;
  manage: boolean;
  reportIds: string[];
  isManager: boolean;
  /** May open /leave/approvals. */
  canOpenApprovals: boolean;
}

export async function leaveAccess(user: CurrentUser): Promise<LeaveAccess> {
  const reportIds = await directReportIds(user._id);
  const viewAll = can(user, "leave.view_all");
  const approve = can(user, "leave.approve");
  const isManager = reportIds.length > 0;
  return {
    staff: isStaff(user),
    viewAll,
    approve,
    manage: can(user, "leave.manage"),
    reportIds,
    isManager,
    canOpenApprovals: approve || viewAll || isManager,
  };
}
