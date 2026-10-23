import "server-only";
import type { Types } from "mongoose";

export interface Learner {
  id: string | Types.ObjectId;
  personType: string;
  department?: string | Types.ObjectId | null;
}

/**
 * Mongo filter for the active learning resources a person can see: assigned to them, or aimed at
 * their person type / "all" (and, when the resource names a department, that department).
 */
export function visibleResourceFilter(p: Learner): Record<string, unknown> {
  return {
    active: true,
    $or: [
      { assignedTo: p.id },
      {
        audience: { $in: [p.personType, "all"] },
        $or: [{ department: null }, ...(p.department ? [{ department: p.department }] : [])],
      },
    ],
  };
}

/** In-memory twin of `visibleResourceFilter` (used by the completion matrix). */
export function resourceAppliesTo(
  r: { active: boolean; audience: string[]; department?: { toString(): string } | null; assignedTo: { toString(): string }[] },
  p: { id: string; personType: string; department?: string },
): boolean {
  if (!r.active) return false;
  if (r.assignedTo.some((a) => a.toString() === p.id)) return true;
  const audienceOk = r.audience.includes(p.personType) || r.audience.includes("all");
  const deptOk = !r.department || r.department.toString() === p.department;
  return audienceOk && deptOk;
}
