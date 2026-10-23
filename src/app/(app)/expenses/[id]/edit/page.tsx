import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Expense } from "@/lib/models";
import { PageBody, PageHeader } from "@/components/ui/page";
import { todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { loadExpenseFormOptions } from "../../form-data";
import { ExpenseForm } from "../../expense-form";

export const metadata = { title: "Edit expense" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  await connectDB();
  const e = await Expense.findById(id).lean();
  // Another person's expense looks the same as a missing one.
  if (!e || e.user.toString() !== user.id) notFound();
  if (e.status !== "draft" && e.status !== "rejected") redirect(`/expenses/${id}`);
  const options = await loadExpenseFormOptions(user);
  return (
    <PageBody>
      <PageHeader back={{ href: `/expenses/${id}`, label: e.expenseNo }} title={`Edit ${e.expenseNo}`} description={e.status === "rejected" ? "This expense was rejected. Fix the issue and submit it again." : undefined} />
      <ExpenseForm
        today={todayKey()}
        categories={options.categories}
        projects={options.projects}
        clients={options.clients}
        departments={options.departments}
        initial={{
          id,
          date: e.date,
          category: e.category,
          amount: String(e.amount),
          taxAmount: e.taxAmount ? String(e.taxAmount) : "",
          vendor: e.vendor ?? "",
          description: e.description,
          project: e.project?.toString() ?? "",
          client: e.client?.toString() ?? "",
          department: e.department?.toString() ?? "",
          type: e.type,
          paymentMode: e.paymentMode ?? "",
          receipts: e.receipts.map((r) => ({ id: r.file.toString(), name: r.name, size: r.size ?? 0, mime: r.mime ?? "application/octet-stream" })),
        }}
      />
    </PageBody>
  );
}
