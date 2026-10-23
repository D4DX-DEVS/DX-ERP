import "server-only";
import { asc, desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { Client, Department, Project } from "@/lib/models";
import { jsonHasField } from "@/lib/sql";
import { can, type CurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

export interface ExpenseFormOptions {
  categories: string[];
  projects: { id: string; label: string }[];
  clients: { id: string; label: string }[] | null;
  departments: { id: string; label: string }[];
}

/** Pick-lists for the expense form, limited to what the person is allowed to see. */
export async function loadExpenseFormOptions(user: CurrentUser): Promise<ExpenseFormOptions> {
  const settings = await getSettings();
  const seeClients = can(user, "crm.view");
  const projectFilter = can(user, "projects.view_all") ? undefined : or(eq(Project.manager, user._id), jsonHasField(Project.team, "user", user._id));
  const [projects, clients, departments] = await Promise.all([
    db().select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title }).from(Project).where(projectFilter).orderBy(desc(Project.createdAt)).limit(500),
    seeClients
      ? db()
          .select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo })
          .from(Client)
          .where(can(user, "crm.confidential") ? undefined : eq(Client.confidential, false))
          .orderBy(asc(Client.name))
          .limit(1000)
      : Promise.resolve(null),
    db().select({ _id: Department._id, name: Department.name }).from(Department).where(eq(Department.active, true)).orderBy(asc(Department.name)),
  ]);
  return {
    categories: settings.expenseCategories,
    projects: projects.map((p) => ({ id: p._id, label: `${p.projectNo} · ${p.title}` })),
    clients: clients ? clients.map((c) => ({ id: c._id, label: `${c.name} · ${c.clientNo}` })) : null,
    departments: departments.map((d) => ({ id: d._id, label: d.name })),
  };
}
