import "server-only";
import { Types } from "mongoose";
import { can, isStaff, type CurrentUser } from "@/lib/auth/session";
import { dateParam, idParam, param, searchRegex, type SearchParams } from "@/lib/query";

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
 * Mongo filters for an expense list. `filter` is what the list shows; `withoutStatus` ignores the status chip so the
 * chips can show counts for every status. Scoping to the viewer's own records / the queue is done here, on the server.
 */
export function expenseFilters(user: CurrentUser, view: ExpenseView, sp: SearchParams): { filter: Record<string, unknown>; withoutStatus: Record<string, unknown> } {
  const base: Record<string, unknown> =
    view === "mine" ? { user: user._id } : view === "approve" ? { status: "submitted", user: { $ne: user._id } } : view === "pay" ? { status: "approved" } : {};

  const conds: Record<string, unknown>[] = [];
  const category = param(sp, "category");
  if (category) conds.push({ category });
  const project = idParam(sp, "project");
  // Ids are real ObjectIds because these filters are also used in aggregations, which do not cast strings.
  if (project) conds.push({ project: new Types.ObjectId(project) });
  const department = idParam(sp, "department");
  if (department) conds.push({ department: new Types.ObjectId(department) });
  const person = idParam(sp, "person");
  if (person && view !== "mine") conds.push({ user: new Types.ObjectId(person) });
  const from = dateParam(sp, "from");
  if (from) conds.push({ date: { $gte: from } });
  const to = dateParam(sp, "to");
  if (to) conds.push({ date: { $lte: to } });
  const q = searchRegex(param(sp, "q"));
  if (q) conds.push({ $or: [{ expenseNo: q }, { description: q }, { vendor: q }] });

  const withoutStatus = { $and: [base, ...conds] };
  const status = param(sp, "status");
  const useStatus = (view === "mine" || view === "all") && (EXPENSE_STATUSES as readonly string[]).includes(status);
  return { withoutStatus, filter: useStatus ? { $and: [base, ...conds, { status }] } : withoutStatus };
}
