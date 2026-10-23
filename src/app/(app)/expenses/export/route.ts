import { getCurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Department, Expense, Project } from "@/lib/models";
import { audit } from "@/lib/audit";
import { exportResponse, isExportFormat } from "@/lib/export";
import { namesFor } from "@/lib/people";
import { statusLabel } from "@/lib/status";
import { dateKey } from "@/lib/time";
import { expenseFilters, resolveView } from "../data";
import { EXPENSE_TYPE_LABEL } from "../constants";

/** GET /expenses/export?view=mine|all|approve|pay&format=csv|xlsx|pdf (+ the list filters). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!isExportFormat(format)) return new Response("Unsupported format", { status: 400 });
  const requested = url.searchParams.get("view") ?? "";
  const view = resolveView(user, requested);
  // A view the person may not open is refused rather than silently swapped for another one.
  if (!view || (requested && requested !== view)) return new Response("You don't have access to these expenses.", { status: 403 });

  await connectDB();
  const { filter } = expenseFilters(user, view, Object.fromEntries(url.searchParams.entries()));
  const rows = await Expense.find(filter).sort({ date: -1, createdAt: -1 }).limit(5000).lean();
  const [names, projects, departments] = await Promise.all([
    namesFor(rows.map((r) => r.user)),
    Project.find({ _id: { $in: rows.flatMap((r) => (r.project ? [r.project] : [])) } }, { projectNo: 1 }).lean(),
    Department.find({}, { name: 1 }).lean(),
  ]);
  const projectNo = new Map(projects.map((p) => [p._id.toString(), p.projectNo]));
  const departmentName = new Map(departments.map((d) => [d._id.toString(), d.name]));

  await audit(user, { action: "export", entity: "expense", summary: `Exported expenses (${format.toUpperCase()}, ${rows.length} records, ${view})` });
  return exportResponse({
    title: "Expenses",
    filename: "expenses",
    format,
    rows,
    columns: [
      { header: "Expense no.", value: (r) => r.expenseNo, width: 14 },
      { header: "Date", value: (r) => r.date },
      { header: "Person", value: (r) => names.get(r.user.toString()) ?? "", width: 24 },
      { header: "Category", value: (r) => r.category, width: 22 },
      { header: "Description", value: (r) => r.description, width: 40 },
      { header: "Vendor", value: (r) => r.vendor ?? "" },
      { header: "Project", value: (r) => (r.project ? (projectNo.get(r.project.toString()) ?? "") : "") },
      { header: "Department", value: (r) => (r.department ? (departmentName.get(r.department.toString()) ?? "") : "") },
      { header: "Type", value: (r) => EXPENSE_TYPE_LABEL[r.type] },
      { header: "Amount", value: (r) => r.amount, type: "money" },
      { header: "Tax", value: (r) => r.taxAmount, type: "money" },
      { header: "Status", value: (r) => statusLabel("expense", r.status) },
      { header: "Decided by", value: (r) => r.approverName ?? "" },
      { header: "Decided on", value: (r) => (r.decidedAt ? dateKey(r.decidedAt) : "") },
      { header: "Paid on", value: (r) => r.payment?.date ?? "" },
      { header: "Payment method", value: (r) => r.payment?.method ?? "" },
      { header: "Reference", value: (r) => r.payment?.reference ?? "" },
    ],
  });
}
