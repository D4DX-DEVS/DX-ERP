import "server-only";
import type { Types } from "mongoose";
import { can, type CurrentUser } from "@/lib/auth/session";

export interface InternTarget {
  _id: Types.ObjectId;
  personType: string;
  reportingManager?: Types.ObjectId | null;
  internship?: { mentor?: Types.ObjectId | null } | null;
}

export interface InternAccess {
  isSelf: boolean;
  isMentor: boolean;
  isManager: boolean;
  canView: boolean;
  /** interns.manage — approve / issue certificates, manage everything. */
  canManage: boolean;
  /** Record evaluations: mentor, interns.review or interns.manage. */
  canEvaluate: boolean;
  /** Update objectives and mark completion: mentor or interns.manage. */
  canRun: boolean;
  canSeeStipend: boolean;
  canSeeTasks: boolean;
}

/** Permissions on one intern / trainee record (FRS §6.3). */
export function internAccess(user: CurrentUser, t: InternTarget): InternAccess {
  const isSelf = user.id === t._id.toString();
  const isMentor = t.internship?.mentor?.toString() === user.id;
  const isManager = t.reportingManager?.toString() === user.id;
  const internLike = t.personType === "intern" || t.personType === "trainee";
  const canManage = internLike && can(user, "interns.manage");
  const canReview = internLike && can(user, "interns.review");
  return {
    isSelf: internLike && isSelf,
    isMentor: internLike && isMentor,
    isManager: internLike && isManager,
    canView: internLike && (isSelf || isMentor || isManager || can(user, "staff.view") || canManage || canReview),
    canManage,
    canEvaluate: internLike && (canManage || canReview || isMentor),
    canRun: internLike && (canManage || isMentor),
    canSeeStipend: internLike && (can(user, "payroll.view") || can(user, "staff.confidential") || canManage),
    canSeeTasks: internLike && (isSelf || isMentor || can(user, "tasks.view_all") || canManage || canReview),
  };
}
