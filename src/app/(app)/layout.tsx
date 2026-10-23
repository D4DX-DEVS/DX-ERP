import { after } from "next/server";
import { can, isStaff, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Expense, LeaveRequest, Movement, Notification, Task, User } from "@/lib/models";
import { buildNav } from "@/lib/nav";
import { presenceFor } from "@/lib/presence";
import { getSettings } from "@/lib/settings";
import { maybeRunJobs } from "@/lib/jobs/runner";
import { Sidebar, Rail } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { TabBar } from "@/components/shell/tab-bar";
import type { Presence, ShellUser } from "@/components/shell/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await connectDB();
  const settings = await getSettings();
  const doneTaskStatuses = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);

  const [reports, mentees, unread, movementPending, leavePendingMgr, leavePendingHr, myOpenTasks, expensesPending] = await Promise.all([
    User.countDocuments({ reportingManager: user._id }),
    User.countDocuments({ "internship.mentor": user._id }),
    Notification.countDocuments({ user: user._id, read: false }),
    can(user, "movement.approve")
      ? Movement.countDocuments({ approvalStatus: { $in: ["pending", "correction_requested"] }, user: { $ne: user._id } })
      : Movement.countDocuments({ approvalStatus: { $in: ["pending", "correction_requested"] }, approver: user._id }),
    LeaveRequest.countDocuments({ status: "pending_manager", manager: user._id }),
    can(user, "leave.approve") ? LeaveRequest.countDocuments({ status: "pending_hr", user: { $ne: user._id } }) : Promise.resolve(0),
    Task.countDocuments({ assignees: user._id, status: { $nin: doneTaskStatuses } }),
    can(user, "expenses.approve") ? Expense.countDocuments({ status: "submitted", user: { $ne: user._id } }) : Promise.resolve(0),
  ]);

  const sections = buildNav({
    user,
    isManager: reports > 0,
    isMentor: mentees > 0,
    badges: {
      movement: { count: movementPending, tone: "alert" },
      leave: { count: leavePendingMgr + leavePendingHr },
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

  after(() => maybeRunJobs());

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
