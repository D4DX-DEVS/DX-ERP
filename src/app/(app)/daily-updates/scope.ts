import "server-only";
import { eq, or, type SQL } from "drizzle-orm";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DailyUpdate, Project, User, type Id } from "@/lib/models";
import { inList, jsonPath } from "@/lib/sql";
import { loggableProjectIds, type Filter } from "@/lib/work-access";

/** The Quality Analyst department tests every project (matched by department name, ignoring case). */
const QA_DEPARTMENT = "quality analyst";

/** Quality Analyst department members and QA engineers (`qa.projects`) post daily updates on any project. */
export function updatesAllProjects(user: CurrentUser): boolean {
  return can(user, "qa.projects") || user.departmentName?.trim().toLowerCase() === QA_DEPARTMENT;
}

/** Projects a user may post daily updates for: every project for QA, otherwise the projects they may log time on. */
export async function dailyUpdateProjectIds(user: CurrentUser): Promise<Id[]> {
  if (!updatesAllProjects(user)) return loggableProjectIds(user);
  const rows = await db().select({ id: Project._id }).from(Project);
  return rows.map((r) => r.id);
}

export interface DailyUpdateScope {
  /** Everyone's updates (`daily_updates.view_all`, the super admin). */
  all: boolean;
  /** Whether the Team tab applies: org-wide access, or people / projects to follow. */
  hasTeam: boolean;
  /** Condition over DailyUpdate rows for the Team tab; `undefined` = no restriction. */
  filter: Filter;
}

/**
 * Whose daily updates a user may read beyond their own. `daily_updates.view_all` sees everyone's; a team lead sees
 * their own, their direct reports' and mentees', and every update posted on a project they manage.
 */
export async function dailyUpdateScope(user: CurrentUser): Promise<DailyUpdateScope> {
  if (can(user, "daily_updates.view_all")) return { all: true, hasTeam: true, filter: undefined };
  const me = user._id;
  const [people, projects] = await Promise.all([
    db()
      .select({ id: User._id })
      .from(User)
      .where(or(eq(User.reportingManager, me), eq(jsonPath(User.internship, "mentor"), me))),
    db().select({ id: Project._id }).from(Project).where(eq(Project.manager, me)),
  ]);
  const any: SQL[] = [eq(DailyUpdate.user, me)];
  if (people.length) any.push(inList(DailyUpdate.user, people.map((p) => p.id)));
  if (projects.length) any.push(inList(DailyUpdate.project, projects.map((p) => p.id)));
  return { all: false, hasTeam: people.length > 0 || projects.length > 0, filter: or(...any) };
}
