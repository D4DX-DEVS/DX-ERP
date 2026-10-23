import type { CurrentUser } from "@/lib/auth/session";
import type { ExportColumn } from "@/lib/export";
import type { Permission } from "@/lib/rbac/permissions";

export type ReportGroup = "HR" | "Movement" | "Projects" | "CRM & Finance";

export const REPORT_GROUPS: ReportGroup[] = ["HR", "Movement", "Projects", "CRM & Finance"];

export type ReportFilterType = "date" | "month" | "select" | "person" | "department" | "project" | "client";

export interface FilterOption {
  value: string;
  label: string;
}

/** Option lists that come from configuration (settings / reference data) and are resolved when the form renders. */
export type OptionSource =
  | "projectStatuses"
  | "taskStatuses"
  | "pipelineStages"
  | "leadSources"
  | "expenseCategories"
  | "assetCategories"
  | "movementCategories"
  | "leaveTypes"
  | "leaveYears"
  | "employmentStatuses";

export interface ReportFilterDef {
  key: string;
  label: string;
  type: ReportFilterType;
  /** Static options for `select` filters. */
  options?: FilterOption[];
  /** Configuration-driven options for `select` filters. */
  optionsFrom?: OptionSource;
  /** Value used when the parameter is absent from the URL (evaluated per request). */
  defaultValue?: () => string;
}

/** Validated filter values keyed by filter key; "" means "not set". */
export type ReportFilters = Record<string, string>;

export interface ReportSummaryItem {
  label: string;
  value: string;
}

export interface ReportResult<Row = unknown> {
  columns: ExportColumn<Row>[];
  rows: Row[];
  summary?: ReportSummaryItem[];
  /** Short caveat shown under the table (e.g. "Personal movement details are hidden"). */
  note?: string;
}

export interface ReportDefinition<Row = unknown> {
  key: string;
  title: string;
  group: ReportGroup;
  description: string;
  /** Every listed permission is required to open the report. */
  permissions: Permission[];
  filters: ReportFilterDef[];
  run(filters: ReportFilters, user: CurrentUser): Promise<ReportResult<Row>>;
}

/**
 * Registers a report with its row type. The registry stores reports with the row type erased;
 * `run` always returns columns and rows of the same row type, so evaluating `column.value(row)`
 * over the returned rows stays type-safe at runtime.
 */
export function defineReport<Row>(definition: ReportDefinition<Row>): ReportDefinition {
  return definition as unknown as ReportDefinition;
}
