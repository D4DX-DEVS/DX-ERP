import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, LeaveType, Project } from "@/lib/models";
import { leaveYearOf } from "@/lib/domain/leave-balance";
import { peopleOptions } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { param, type SearchParams } from "@/lib/query";
import { notInList } from "@/lib/sql";
import { todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { projectFilter } from "@/lib/work-access";
import { departmentNames, hiddenClientIds } from "./shared";
import type { FilterOption, OptionSource, ReportDefinition, ReportFilterDef, ReportFilters } from "./types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A real calendar day ("2026-02-30" has the right shape but is not a date). */
function isRealDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Statically known option values for a filter (used to validate `select` input without a DB round trip). */
const STATIC_VALUES = (def: ReportFilterDef): Set<string> | null => (def.options ? new Set(def.options.map((o) => o.value)) : null);

/**
 * Reads and validates filter values from URL search params. Absent params fall back to the
 * filter default; malformed values are dropped (treated as "not set").
 */
export function parseFilters(def: ReportDefinition, sp: SearchParams | URLSearchParams): ReportFilters {
  const read = (key: string): string | undefined => {
    if (sp instanceof URLSearchParams) return sp.has(key) ? (sp.get(key) ?? "").trim() : undefined;
    const raw = sp[key];
    if (raw === undefined) return undefined;
    return param(sp, key);
  };
  const out: ReportFilters = {};
  for (const filter of def.filters) {
    const supplied = read(filter.key);
    const raw = supplied === undefined ? (filter.defaultValue?.() ?? "") : supplied;
    let value = "";
    switch (filter.type) {
      case "date":
        value = isRealDay(raw) ? raw : "";
        break;
      case "month":
        value = MONTH.test(raw) ? raw : "";
        break;
      case "select": {
        const allowed = STATIC_VALUES(filter);
        // Configuration-driven options (lead sources, categories…) may contain spaces and symbols; they are
        // only ever compared as plain strings, so a length limit is enough.
        value = allowed ? (allowed.has(raw) ? raw : "") : raw.length <= 100 ? raw : "";
        break;
      }
      case "person":
      case "department":
      case "project":
      case "client":
        value = isObjectId(raw) ? raw : "";
        break;
    }
    out[filter.key] = value;
  }
  return out;
}

export interface ResolvedFilter {
  def: ReportFilterDef;
  value: string;
  options: FilterOption[];
}

async function sourceOptions(source: OptionSource): Promise<FilterOption[]> {
  const settings = await getSettings();
  switch (source) {
    case "projectStatuses":
      return settings.projectStatuses.map((s) => ({ value: s.key, label: s.label }));
    case "taskStatuses":
      return settings.taskStatuses.map((s) => ({ value: s.key, label: s.label }));
    case "pipelineStages":
      return settings.pipelineStages.map((s) => ({ value: s.key, label: s.label }));
    case "leadSources":
      return settings.leadSources.map((s) => ({ value: s, label: s }));
    case "expenseCategories":
      return settings.expenseCategories.map((s) => ({ value: s, label: s }));
    case "assetCategories":
      return settings.assetCategories.map((s) => ({ value: s, label: s }));
    case "movementCategories":
      return settings.movement.categories.map((c) => ({ value: c.key, label: c.label }));
    case "employmentStatuses":
      return settings.employmentStatuses.map((s) => ({ value: s.key, label: s.label }));
    case "leaveTypes": {
      const types = await db().select({ id: LeaveType._id, name: LeaveType.name }).from(LeaveType).where(eq(LeaveType.active, true)).orderBy(asc(LeaveType.order), asc(LeaveType.name));
      return types.map((t) => ({ value: t.id, label: t.name }));
    }
    case "leaveYears": {
      const current = leaveYearOf(todayKey(), settings);
      return [current + 1, current, current - 1, current - 2].map((y) => ({ value: String(y), label: settings.leave.yearStartMonth === 1 ? String(y) : `${y}–${String(y + 1).slice(2)}` }));
    }
  }
}

/** Option lists for the filter form: pickers load reference data, selects use static or configured options. */
export async function resolveFilters(def: ReportDefinition, values: ReportFilters, user: CurrentUser): Promise<ResolvedFilter[]> {
  const needs = (type: ReportFilterDef["type"]) => def.filters.some((f) => f.type === type);
  const [people, departments, projects, clients] = await Promise.all([
    needs("person") ? peopleOptions({ includeExited: true }) : Promise.resolve([]),
    needs("department") ? departmentNames() : Promise.resolve(new Map<string, string>()),
    // Project and client pickers only list what the viewer may open.
    needs("project")
      ? db().select({ id: Project._id, projectNo: Project.projectNo, title: Project.title }).from(Project).where(projectFilter(user)).orderBy(desc(Project.createdAt)).limit(500)
      : Promise.resolve([]),
    needs("client") && can(user, "crm.view")
      ? hiddenClientIds(user).then((hidden) =>
          db()
            .select({ id: Client._id, name: Client.name })
            .from(Client)
            .where(hidden.length ? notInList(Client._id, hidden) : undefined)
            .orderBy(asc(Client.name))
            .limit(500),
        )
      : Promise.resolve([]),
  ]);

  const resolved: ResolvedFilter[] = [];
  for (const filter of def.filters) {
    let options: FilterOption[] = [];
    if (filter.type === "select") options = filter.options ?? (filter.optionsFrom ? await sourceOptions(filter.optionsFrom) : []);
    if (filter.type === "person") options = people.map((p) => ({ value: p.id, label: `${p.name} (${p.employeeId})` }));
    if (filter.type === "department") options = [...departments].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    if (filter.type === "project") options = projects.map((p) => ({ value: p.id, label: `${p.projectNo} · ${p.title}` }));
    if (filter.type === "client") options = clients.map((c) => ({ value: c.id, label: c.name }));
    resolved.push({ def: filter, value: values[filter.key] ?? "", options });
  }
  return resolved;
}

/** Human-readable filter summary for export headers and the audit log ("From 2026-10-01 · To 2026-10-21"). */
export function describeFilters(resolved: ResolvedFilter[]): string {
  return resolved
    .filter((r) => r.value)
    .map((r) => {
      const label = r.options.find((o) => o.value === r.value)?.label ?? r.value;
      return `${r.def.label}: ${label}`;
    })
    .join(" · ");
}
