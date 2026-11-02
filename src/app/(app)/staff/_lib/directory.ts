import "server-only";
import { and, eq, gte, isNotNull, lt, lte, type SQL } from "drizzle-orm";
import type { AppSettings } from "@/lib/config-defaults";
import { User } from "@/lib/models";
import { idParam, param, type SearchParams } from "@/lib/query";
import { inList, searchAny } from "@/lib/sql";
import { addDays, todayKey } from "@/lib/time";
import { CONTRACT_WARNING_DAYS } from "./constants";

/** Contract filter: "ending" = last day within the warning window, "ended" = end date passed, "any" = has a contract period. */
export function contractFilter(value: string, today = todayKey()): SQL | undefined {
  if (value === "ending") return and(gte(User.contractEnd, today), lte(User.contractEnd, addDays(today, CONTRACT_WARNING_DAYS)));
  if (value === "ended") return lt(User.contractEnd, today);
  if (value === "any") return isNotNull(User.contractStart);
  return undefined;
}

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
  const contract = param(sp, "contract");
  return and(
    typeCond,
    q,
    department ? eq(User.department, department) : undefined,
    settings.employmentStatuses.some((s) => s.key === status) ? eq(User.status, status) : undefined,
    /^[a-z0-9_-]{1,40}$/i.test(role) ? eq(User.role, role) : undefined,
    access === "on" ? eq(User.accountActive, true) : access === "off" ? eq(User.accountActive, false) : undefined,
    contractFilter(contract),
  );
}
