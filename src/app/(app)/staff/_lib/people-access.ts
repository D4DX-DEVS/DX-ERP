import "server-only";
import { can, type CurrentUser } from "@/lib/auth/session";
import type { Id } from "@/lib/models";

export interface AccessTarget {
  _id: Id;
  personType: string;
  reportingManager?: Id | null;
  internship?: { mentor?: Id | null } | null;
}

export interface PersonAccess {
  isSelf: boolean;
  isManager: boolean;
  isMentor: boolean;
  /** Target is an intern or trainee. */
  internLike: boolean;
  canView: boolean;
  /** Date of birth, personal email, address and emergency contact. */
  canSeePersonal: boolean;
  canEdit: boolean;
  /** Documents and change history: the person and HR / admin only, not leads who just hold `staff.view`. */
  canSeeRecords: boolean;
  canConfidential: boolean;
  canManageUsers: boolean;
}

/**
 * Who may open a person's profile and what they may see (FRS §3, §5.1). The super admin
 * account (personType "admin") is never exposed through the staff routes.
 */
export function personAccess(user: CurrentUser, target: AccessTarget): PersonAccess {
  const isSelf = user.id === target._id;
  const isManager = target.reportingManager === user.id;
  const isMentor = target.internship?.mentor === user.id;
  const internLike = target.personType === "intern" || target.personType === "trainee";
  const listed = target.personType !== "admin";
  const canEdit = listed && can(user, "staff.edit");
  return {
    isSelf,
    isManager,
    isMentor,
    internLike,
    canView: listed && (isSelf || can(user, "staff.view") || isManager || isMentor || (internLike && can(user, "interns.manage"))),
    canSeePersonal: listed && (isSelf || canEdit || can(user, "staff.confidential") || isManager || isMentor),
    canEdit,
    canSeeRecords: listed && (isSelf || canEdit || can(user, "staff.confidential")),
    canConfidential: listed && can(user, "staff.confidential"),
    canManageUsers: listed && can(user, "users.manage"),
  };
}
