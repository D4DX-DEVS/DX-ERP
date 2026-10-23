import "server-only";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { LearningResource, type Id } from "@/lib/models";
import { jsonHas, jsonHasAny } from "@/lib/sql";

export interface Learner {
  id: Id;
  personType: string;
  department?: Id | null;
}

/**
 * Condition for the active learning resources a person can see: assigned to them, or aimed at
 * their person type / "all" (and, when the resource names a department, that department).
 */
export function visibleResourceFilter(p: Learner): SQL {
  return and(
    eq(LearningResource.active, true),
    or(
      jsonHas(LearningResource.assignedTo, p.id),
      and(
        jsonHasAny(LearningResource.audience, [p.personType, "all"]),
        p.department ? or(isNull(LearningResource.department), eq(LearningResource.department, p.department)) : isNull(LearningResource.department),
      ),
    ),
  )!;
}

/** In-memory twin of `visibleResourceFilter` (used by the completion matrix). */
export function resourceAppliesTo(
  r: { active: boolean; audience: string[]; department?: Id | null; assignedTo: Id[] },
  p: { id: string; personType: string; department?: string },
): boolean {
  if (!r.active) return false;
  if (r.assignedTo.includes(p.id)) return true;
  const audienceOk = r.audience.includes(p.personType) || r.audience.includes("all");
  const deptOk = !r.department || r.department === p.department;
  return audienceOk && deptOk;
}
