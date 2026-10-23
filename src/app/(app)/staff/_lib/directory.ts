import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import type { AppSettings } from "@/lib/config-defaults";
import { User } from "@/lib/models";
import { idParam, param, type SearchParams } from "@/lib/query";
import { inList, searchAny } from "@/lib/sql";

export const STAFF_TYPES = ["employee", "trainee", "intern"] as const;

/**
 * SQL condition for the staff directory (page + export). The super admin (personType "admin")
 * is always excluded. `ignoreType` is used for the per-type chip counts.
 */
export function staffFilter(sp: SearchParams, settings: AppSettings, opts: { ignoreType?: boolean } = {}): SQL | undefined {
  const type = param(sp, "type");
  const typeCond = !opts.ignoreType && (STAFF_TYPES as readonly string[]).includes(type) ? eq(User.personType, type as (typeof STAFF_TYPES)[number]) : inList(User.personType, [...STAFF_TYPES]);
  const q = searchAny(param(sp, "q"), User.name, User.email, User.employeeId);
  const department = idParam(sp, "department");
  const status = param(sp, "status");
  const role = param(sp, "role");
  const access = param(sp, "access");
  return and(
    typeCond,
    q,
    department ? eq(User.department, department) : undefined,
    settings.employmentStatuses.some((s) => s.key === status) ? eq(User.status, status) : undefined,
    /^[a-z0-9_-]{1,40}$/i.test(role) ? eq(User.role, role) : undefined,
    access === "on" ? eq(User.accountActive, true) : access === "off" ? eq(User.accountActive, false) : undefined,
  );
}
