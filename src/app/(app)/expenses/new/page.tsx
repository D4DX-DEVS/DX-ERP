import { forbidden } from "next/navigation";
import { isStaff, requireUser } from "@/lib/auth/session";
import { PageBody, PageHeader } from "@/components/ui/page";
import { todayKey } from "@/lib/time";
import { loadExpenseFormOptions } from "../form-data";
import { ExpenseForm } from "../expense-form";

export const metadata = { title: "New expense" };

export default async function NewExpensePage() {
  const user = await requireUser();
  if (!isStaff(user)) forbidden();
  const options = await loadExpenseFormOptions(user);
  return (
    <PageBody>
      <PageHeader back={{ href: "/expenses", label: "Expenses" }} title="New expense" description="Save it as a draft, or submit it straight away for approval." />
      <ExpenseForm
        today={todayKey()}
        categories={options.categories}
        projects={options.projects}
        clients={options.clients}
        departments={options.departments}
        initial={{ date: todayKey(), category: "", amount: "", taxAmount: "", vendor: "", description: "", project: "", client: "", department: user.departmentId ?? "", type: "reimbursable", paymentMode: "", receipts: [] }}
      />
    </PageBody>
  );
}
