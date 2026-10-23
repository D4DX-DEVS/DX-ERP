import "server-only";
import { dateParam, idParam, param, searchRegex, type SearchParams } from "@/lib/query";
import { endOfDay, startOfDay } from "@/lib/time";
import { AUDIT_ACTIONS } from "./meta";

/** Mongo filter for the audit trail from URL parameters. Shared by the page and the export route. */
export function buildAuditFilter(sp: SearchParams): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");
  if (from || to) filter.at = { ...(from ? { $gte: startOfDay(from) } : {}), ...(to ? { $lte: endOfDay(to) } : {}) };
  const actor = idParam(sp, "actor");
  if (actor) filter.actor = actor;
  const action = param(sp, "action");
  if ((AUDIT_ACTIONS as string[]).includes(action)) filter.action = action;
  const entity = param(sp, "entity");
  if (/^[a-z0-9_]{1,40}$/.test(entity)) filter.entity = entity;
  const rx = searchRegex(param(sp, "q"));
  if (rx) filter.$or = [{ summary: rx }, { ref: rx }];
  return filter;
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
