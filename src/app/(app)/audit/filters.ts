import "server-only";
import { and, eq, gte, lte, type SQL } from "drizzle-orm";
import { AuditLog } from "@/lib/models";
import { dateParam, idParam, param, type SearchParams } from "@/lib/query";
import { searchAny } from "@/lib/sql";
import { endOfDay, startOfDay } from "@/lib/time";
import { AUDIT_ACTIONS } from "./meta";

/** SQL condition for the audit trail from URL parameters (`undefined` = no filter). Shared by the page and the export route. */
export function buildAuditFilter(sp: SearchParams): SQL | undefined {
  const conditions: SQL[] = [];
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");
  if (from) conditions.push(gte(AuditLog.at, startOfDay(from)));
  if (to) conditions.push(lte(AuditLog.at, endOfDay(to)));
  const actor = idParam(sp, "actor");
  if (actor) conditions.push(eq(AuditLog.actor, actor));
  const action = param(sp, "action");
  if ((AUDIT_ACTIONS as string[]).includes(action)) conditions.push(eq(AuditLog.action, action));
  const entity = param(sp, "entity");
  if (/^[a-z0-9_]{1,40}$/.test(entity)) conditions.push(eq(AuditLog.entity, entity));
  const search = searchAny(param(sp, "q"), AuditLog.summary, AuditLog.ref);
  if (search) conditions.push(search);
  return and(...conditions);
}

/** Human description of the active filters (printed on exports). */
export function describeAuditFilter(sp: SearchParams, actorName?: string): string {
  const parts: string[] = [];
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");
  if (from || to) parts.push(`Period ${from ?? "start"} to ${to ?? "today"}`);
  if (actorName) parts.push(`User ${actorName}`);
  const action = param(sp, "action");
  if (action) parts.push(`Action ${action}`);
  const entity = param(sp, "entity");
  if (entity) parts.push(`Entity ${entity}`);
  const q = param(sp, "q");
  if (q) parts.push(`Search "${q}"`);
  return parts.join(" · ") || "All entries";
}
