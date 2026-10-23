import "server-only";
import { and, eq, gte, lte, ne, type SQL } from "drizzle-orm";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { Expense } from "@/lib/models";
import { dateParam, idParam, param, type SearchParams } from "@/lib/query";
import { searchAny } from "@/lib/sql";

export type ExpenseView = "mine" | "all" | "approve" | "pay";

export const EXPENSE_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;

/** Tabs the person may open, in display order. */
export function allowedViews(user: CurrentUser): ExpenseView[] {
  const views: ExpenseView[] = [];
  if (isStaff(user)) views.push("mine");
  if (can(user, "expenses.view_all")) views.push("all");
  if (can(user, "expenses.approve")) views.push("approve");
  if (can(user, "expenses.pay")) views.push("pay");
  return views;
}

export function resolveView(user: CurrentUser, requested: string): ExpenseView | null {
  const views = allowedViews(user);
  if (views.length === 0) return null;
  if ((views as string[]).includes(requested)) return requested as ExpenseView;
  if (views.includes("all")) return "all";
  return views[0];
}

/**
 * SQL conditions for an expense list. `filter` is what the list shows; `withoutStatus` ignores the status chip so the
 * chips can show counts for every status. Scoping to the viewer's own records / the queue is done here, on the server.
 */
export function expenseFilters(user: CurrentUser, view: ExpenseView, sp: SearchParams): { filter: SQL | undefined; withoutStatus: SQL | undefined } {
  const base =
    view === "mine"
      ? eq(Expense.user, user._id)
      : view === "approve"
        ? and(eq(Expense.status, "submitted"), ne(Expense.user, user._id))
        : view === "pay"
          ? eq(Expense.status, "approved")
          : undefined;

  const category = param(sp, "category");
  const project = idParam(sp, "project");
  const department = idParam(sp, "department");
  const person = idParam(sp, "person");
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");
  const withoutStatus = and(
    base,
    category ? eq(Expense.category, category) : undefined,
    project ? eq(Expense.project, project) : undefined,
    department ? eq(Expense.department, department) : undefined,
    person && view !== "mine" ? eq(Expense.user, person) : undefined,
    from ? gte(Expense.date, from) : undefined,
    to ? lte(Expense.date, to) : undefined,
    searchAny(param(sp, "q"), Expense.expenseNo, Expense.description, Expense.vendor),
  );
  const status = param(sp, "status");
  const useStatus = (view === "mine" || view === "all") && (EXPENSE_STATUSES as readonly string[]).includes(status);
  return { withoutStatus, filter: useStatus ? and(withoutStatus, eq(Expense.status, status as (typeof EXPENSE_STATUSES)[number])) : withoutStatus };
}
