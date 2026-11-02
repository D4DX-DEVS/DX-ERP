import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { can, isStaff, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { CompOffClaim, Expense, LeaveRequest, Movement, Notification, Task, User } from "@/lib/models";
import { buildNav } from "@/lib/nav";
import { presenceFor } from "@/lib/presence";
import { getSettings } from "@/lib/settings";
import { inList, jsonHas, jsonPath, notInList } from "@/lib/sql";
import { Sidebar, Rail } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { TabBar } from "@/components/shell/tab-bar";
import type { Presence, ShellUser } from "@/components/shell/types";

/** Scalar `select count(*)` subquery, so every shell count comes back in a single D1 round trip. */
const countOf = (table: SQLiteTable, where: SQL | undefined) => sql<number>`(select count(*) from ${table} where ${where ?? sql`1`})`.mapWith(Number);
const zero = sql<number>`0`;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await getSettings();
  const doneTaskStatuses = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);
  const me = user._id;
  const awaitingApproval = inList(Movement.approvalStatus, ["pending", "correction_requested"]);

  // The shell's badges and nav flags are all counts: fetch them together (one query, run against the user's own row).
  const [counts] = await db()
    .select({
      reports: countOf(User, eq(User.reportingManager, me)),
      mentees: countOf(User, eq(jsonPath(User.internship, "mentor"), me)),
      unread: countOf(Notification, and(eq(Notification.user, me), eq(Notification.read, false))),
      movementPending: countOf(Movement, can(user, "movement.approve") ? and(awaitingApproval, ne(Movement.user, me)) : and(awaitingApproval, eq(Movement.approver, me))),
      leavePendingMgr: countOf(LeaveRequest, and(eq(LeaveRequest.status, "pending_manager"), eq(LeaveRequest.manager, me))),
      leavePendingHr: can(user, "leave.approve") ? countOf(LeaveRequest, and(eq(LeaveRequest.status, "pending_hr"), ne(LeaveRequest.user, me))) : zero,
      compOffPending: countOf(CompOffClaim, and(eq(CompOffClaim.status, "pending"), can(user, "leave.approve") ? ne(CompOffClaim.user, me) : eq(CompOffClaim.manager, me))),
      myOpenTasks: countOf(Task, and(jsonHas(Task.assignees, me), notInList(Task.status, doneTaskStatuses))),
      expensesPending: can(user, "expenses.approve") ? countOf(Expense, and(eq(Expense.status, "submitted"), ne(Expense.user, me))) : zero,
    })
    .from(User)
    .where(eq(User._id, me))
    .limit(1);
  const { reports = 0, mentees = 0, unread = 0, movementPending = 0, leavePendingMgr = 0, leavePendingHr = 0, compOffPending = 0, myOpenTasks = 0, expensesPending = 0 } = counts ?? {};

  const sections = buildNav({
    user,
    isManager: reports > 0,
    isMentor: mentees > 0,
    badges: {
      movement: { count: movementPending, tone: "alert" },
      leave: { count: leavePendingMgr + leavePendingHr + compOffPending },
      tasks: { count: myOpenTasks },
      expenses: { count: expensesPending },
    },
  });

  const staff = isStaff(user);
  const presence: Presence = staff ? await presenceFor(user.id) : { state: "none", label: "" };
  const shellUser: ShellUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    photo: user.photo,
    roleName: user.roleName,
    employeeId: user.employeeId,
    title: user.designationName ?? user.roleName,
    isStaff: staff,
  };


  return (
    <div className="flex min-h-dvh">
      <Sidebar sections={sections} user={shellUser} />
      <Rail sections={sections} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={shellUser} presence={presence} unread={unread} />
        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
      <TabBar sections={sections} user={shellUser} unread={unread} />
    </div>
  );
}
