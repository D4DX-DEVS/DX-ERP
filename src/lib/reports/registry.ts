import "server-only";
import { can, type CurrentUser } from "@/lib/auth/session";
import { crmReports } from "./crm";
import { financeReports } from "./finance";
import { hrReports } from "./hr";
import { movementReports } from "./movement";
import { projectReports } from "./projects";
import { REPORT_GROUPS, type ReportDefinition, type ReportGroup } from "./types";

/** Typed registry of every report (FRS §8.9, §19). Order within a group is the order shown in the catalogue. */
export const REPORTS: ReportDefinition[] = [...hrReports, ...movementReports, ...projectReports, ...crmReports, ...financeReports];

const BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

export function getReport(key: string): ReportDefinition | undefined {
  return BY_KEY.get(key);
}

/** All of a report's permissions are required. */
export function canOpenReport(user: CurrentUser, report: ReportDefinition): boolean {
  return report.permissions.every((p) => can(user, p));
}

/** Reports the user may open, grouped in catalogue order (empty groups omitted). */
export function reportCatalogue(user: CurrentUser): { group: ReportGroup; reports: ReportDefinition[] }[] {
  return REPORT_GROUPS.map((group) => ({ group, reports: REPORTS.filter((r) => r.group === group && canOpenReport(user, r)) })).filter((g) => g.reports.length > 0);
}
