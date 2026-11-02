import "server-only";
import { eq } from "drizzle-orm";
import { ActionError, actionUser } from "@/lib/actions";
import { can } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { isObjectId } from "@/lib/validation";

/**
 * The signed-in user acting on a person's documents / education records: the person themself (`self`) or
 * someone who manages their record (`manage`: staff.edit, or interns.manage for interns and trainees).
 */
export async function documentActor(personId: string) {
  const user = await actionUser();
  if (!isObjectId(personId)) throw new ActionError("Person not found.");
  const [target] = await db()
    .select({ _id: User._id, personType: User.personType, name: User.name, employeeId: User.employeeId, documentUploadOpen: User.documentUploadOpen })
    .from(User)
    .where(eq(User._id, personId))
    .limit(1);
  if (!target || target.personType === "admin") throw new ActionError("Person not found.");
  const internLike = target.personType === "intern" || target.personType === "trainee";
  const self = user.id === personId;
  const manage = can(user, "staff.edit") || (internLike && can(user, "interns.manage"));
  if (!self && !manage) throw new ActionError("You don't have permission to manage this person's documents.");
  return { user, target, self, manage };
}
