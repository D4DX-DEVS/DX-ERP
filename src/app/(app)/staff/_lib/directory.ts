import "server-only";
import { Types } from "mongoose";
import type { AppSettings } from "@/lib/config-defaults";
import { idParam, param, searchRegex, type SearchParams } from "@/lib/query";

export const STAFF_TYPES = ["employee", "trainee", "intern"] as const;

/**
 * Mongo filter for the staff directory (page + export). The super admin (personType "admin")
 * is always excluded. `ignoreType` is used for the per-type chip counts.
 */
export function staffFilter(sp: SearchParams, settings: AppSettings, opts: { ignoreType?: boolean } = {}): Record<string, unknown> {
  const filter: Record<string, unknown> = { personType: { $in: [...STAFF_TYPES] } };
  const type = param(sp, "type");
  if (!opts.ignoreType && (STAFF_TYPES as readonly string[]).includes(type)) filter.personType = type;
  const q = searchRegex(param(sp, "q"));
  if (q) filter.$or = [{ name: q }, { email: q }, { employeeId: q }];
  const department = idParam(sp, "department");
  // ObjectId (not string): the same filter feeds aggregate() $match, which does not cast.
  if (department) filter.department = new Types.ObjectId(department);
  const status = param(sp, "status");
  if (settings.employmentStatuses.some((s) => s.key === status)) filter.status = status;
  const role = param(sp, "role");
  if (/^[a-z0-9_-]{1,40}$/i.test(role)) filter.role = role;
  const access = param(sp, "access");
  if (access === "on") filter.accountActive = true;
  if (access === "off") filter.accountActive = false;
  return filter;
}
