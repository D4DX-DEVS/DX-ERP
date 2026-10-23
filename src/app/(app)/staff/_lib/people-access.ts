import "server-only";
import type { Types } from "mongoose";
import { can, type CurrentUser } from "@/lib/auth/session";

export interface AccessTarget {
  _id: Types.ObjectId;
  personType: string;
  reportingManager?: Types.ObjectId | null;
  internship?: { mentor?: Types.ObjectId | null } | null;
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
  canConfidential: boolean;
  canManageUsers: boolean;
}

/**
 * Who may open a person's profile and what they may see (FRS §3, §5.1). The super admin
 * account (personType "admin") is never exposed through the staff routes.
 */
export function personAccess(user: CurrentUser, target: AccessTarget): PersonAccess {
  const isSelf = user.id === target._id.toString();
  const isManager = target.reportingManager?.toString() === user.id;
  const isMentor = target.internship?.mentor?.toString() === user.id;
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
    canConfidential: listed && can(user, "staff.confidential"),
    canManageUsers: listed && can(user, "users.manage"),
  };
}
