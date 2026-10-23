import "server-only";
import { connectDB } from "@/lib/db";
import { Client, Department, Project } from "@/lib/models";
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
  await connectDB();
  const settings = await getSettings();
  const seeClients = can(user, "crm.view");
  const projectFilter = can(user, "projects.view_all") ? {} : { $or: [{ manager: user._id }, { "team.user": user._id }] };
  const [projects, clients, departments] = await Promise.all([
    Project.find(projectFilter, { projectNo: 1, title: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
    seeClients ? Client.find(can(user, "crm.confidential") ? {} : { confidential: false }, { name: 1, clientNo: 1 }).sort({ name: 1 }).limit(1000).lean() : Promise.resolve(null),
    Department.find({ active: true }, { name: 1 }).sort({ name: 1 }).lean(),
  ]);
  return {
    categories: settings.expenseCategories,
    projects: projects.map((p) => ({ id: p._id.toString(), label: `${p.projectNo} · ${p.title}` })),
    clients: clients ? clients.map((c) => ({ id: c._id.toString(), label: `${c.name} · ${c.clientNo}` })) : null,
    departments: departments.map((d) => ({ id: d._id.toString(), label: d.name })),
  };
}
