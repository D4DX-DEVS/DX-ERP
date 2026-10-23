import type { Metadata } from "next";
import { CalendarPlus, FileBarChart, LogOut } from "lucide-react";
import { can, canAny, isInternLike, isStaff, requireUser, type CurrentUser } from "@/lib/auth/session";
import { param, withParams, type SearchParams } from "@/lib/query";
import { fmtLongDate, greeting } from "@/lib/time";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { CurrentMovementCard } from "@/app/(app)/movement/current-movement-card";
import { TodayAttendanceCard } from "@/app/(app)/attendance/today-card";
import { isReportingManager } from "./_lib/queries";
import { FinanceChartCard, MonthGlanceCard } from "./_components/org-finance";
import { ApprovalsCard, HeadcountCard, OutsideCard, PresentCard } from "./_components/org-kpis";
import { OutOfOfficeCard, WaitingCard } from "./_components/org-movement";
import { OperationalSummaryCard, summaryAccess } from "./_components/org-summary";
import { OverdueTasksCard, PipelineCard, ProjectsCard } from "./_components/org-work";
import { AnnouncementsCard, LatestNotificationsCard, LeaveCard, MyMovementsCard, MyTasksCard, TimesheetWeekCard } from "./_components/personal";
import { FeedbackCard, InternAttendanceCard, InternshipCard, InternTasksCard, LearningCard, MentorCard } from "./_components/intern";
import { Widget } from "./_components/widget";

export const metadata: Metadata = { title: "Dashboard" };

type View = "personal" | "org";

const APPROVAL_PERMISSIONS = ["leave.approve", "movement.approve", "attendance.approve", "expenses.approve", "timesheets.approve", "payroll.approve"] as const;

/** Grids that fill the row with however many cards the viewer is allowed to see (literal classes so Tailwind finds them). */
const FLUID_KPI = "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]";
const FLUID_CARDS = "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]";

function PersonalView({ user }: { user: CurrentUser }) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Widget title="Today's attendance" tall>
          <TodayAttendanceCard userId={user.id} />
        </Widget>
        <Widget title="Current movement">
          <CurrentMovementCard userId={user.id} />
        </Widget>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Widget title="My tasks" className="lg:col-span-2" tall>
          <MyTasksCard user={user} />
        </Widget>
        <Widget title="Leave balance" tall>
          <LeaveCard user={user} />
        </Widget>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Widget title="This week's timesheet" tall>
          <TimesheetWeekCard userId={user.id} />
        </Widget>
        <Widget title="My movements" className="lg:col-span-2" tall>
          <MyMovementsCard userId={user.id} />
        </Widget>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Widget title="Announcements">
          <AnnouncementsCard user={user} />
        </Widget>
        <Widget title="Latest notifications">
          <LatestNotificationsCard userId={user.id} />
        </Widget>
      </div>
    </>
  );
}

function InternView({ user }: { user: CurrentUser }) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Widget title="Today's attendance" tall>
          <TodayAttendanceCard userId={user.id} />
        </Widget>
        <Widget title="Current movement">
          <CurrentMovementCard userId={user.id} />
        </Widget>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Widget title="Internship progress" className="lg:col-span-2" tall>
          <InternshipCard userId={user.id} />
        </Widget>
        <Widget title="Mentor">
          <MentorCard userId={user.id} />
        </Widget>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Widget title="Attendance this month" tall>
          <InternAttendanceCard userId={user.id} />
        </Widget>
        <Widget title="Tasks & submissions" className="lg:col-span-2" tall>
          <InternTasksCard user={user} />
        </Widget>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Widget title="Learning" tall>
          <LearningCard user={user} />
        </Widget>
        <Widget title="Latest feedback" tall>
          <FeedbackCard userId={user.id} />
        </Widget>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Widget title="Announcements">
          <AnnouncementsCard user={user} />
        </Widget>
        <Widget title="Latest notifications">
          <LatestNotificationsCard userId={user.id} />
        </Widget>
      </div>
      <Widget title="My movements" tall>
        <MyMovementsCard userId={user.id} />
      </Widget>
    </>
  );
}

function OrgView({ user, canApprove }: { user: CurrentUser; canApprove: boolean }) {
  const sees = {
    headcount: can(user, "staff.view"),
    present: can(user, "attendance.view_all"),
    movements: can(user, "movement.view_all"),
    finance: can(user, "invoices.view"),
    projects: can(user, "projects.view_all"),
    crm: can(user, "crm.view"),
    tasks: can(user, "tasks.view_all"),
  };
  const summary = Object.values(summaryAccess(user)).some(Boolean);
  const hasKpis = sees.headcount || sees.present || sees.movements || canApprove;
  const hasWork = sees.projects || sees.crm || sees.tasks;
  const hasMovementRow = sees.movements || canApprove;

  return (
    <>
      {hasKpis && (
        <div className={FLUID_KPI}>
          {sees.headcount && (
            <Widget title="Headcount">
              <HeadcountCard />
            </Widget>
          )}
          {sees.present && (
            <Widget title="Present today">
              <PresentCard />
            </Widget>
          )}
          {sees.movements && (
            <Widget title="Outside the office">
              <OutsideCard />
            </Widget>
          )}
          {canApprove && (
            <Widget title="Pending approvals">
              <ApprovalsCard user={user} />
            </Widget>
          )}
        </div>
      )}

      {sees.finance && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Widget title="Finance chart" className="lg:col-span-2" tall>
            <FinanceChartCard />
          </Widget>
          <Widget title="Month at a glance" tall>
            <MonthGlanceCard />
          </Widget>
        </div>
      )}

      {hasMovementRow && (
        <div className="grid gap-4 lg:grid-cols-5">
          {sees.movements && (
            <Widget title="Out of office now" className={canApprove ? "lg:col-span-3" : "lg:col-span-5"} tall>
              <OutOfOfficeCard showPersonal={can(user, "movement.view_personal")} />
            </Widget>
          )}
          {canApprove && (
            <Widget title="Waiting for you" className={sees.movements ? "lg:col-span-2" : "lg:col-span-5"} tall>
              <WaitingCard user={user} />
            </Widget>
          )}
        </div>
      )}

      {hasWork && (
        <div className={FLUID_CARDS}>
          {sees.projects && (
            <Widget title="Projects" tall>
              <ProjectsCard />
            </Widget>
          )}
          {sees.crm && (
            <Widget title="Clients & pipeline" tall>
              <PipelineCard user={user} />
            </Widget>
          )}
          {sees.tasks && (
            <Widget title="Overdue tasks" tall>
              <OverdueTasksCard />
            </Widget>
          )}
        </div>
      )}

      {summary && (
        <Widget title="Operational summary" tall>
          <OperationalSummaryCard user={user} />
        </Widget>
      )}
    </>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;

  const staff = isStaff(user);
  const intern = isInternLike(user);
  const manager = await isReportingManager(user.id);
  const canApprove = manager || canAny(user, [...APPROVAL_PERMISSIONS]);
  const orgWidgets = canAny(user, ["staff.view", "attendance.view_all", "movement.view_all", "invoices.view", "projects.view_all", "crm.view", "tasks.view_all"]) || Object.values(summaryAccess(user)).some(Boolean);
  const hasOrg = orgWidgets || canApprove;

  // Staff see their own day; people with organisation-wide access can also switch to the overview.
  const tabs = staff && hasOrg;
  const preferOrg = can(user, "attendance.view_all") || can(user, "movement.view_all") || can(user, "invoices.view");
  const requested = param(sp, "view");
  const view: View = !staff ? "org" : !hasOrg ? "personal" : requested === "personal" || requested === "org" ? requested : preferOrg ? "org" : "personal";

  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
  const subtitle = staff ? [user.designationName ?? user.roleName, user.employeeId].filter(Boolean).join(" · ") : "Super admin";

  return (
    <PageBody>
      <PageHeader
        overline={fmtLongDate()}
        title={`${greeting()}, ${firstName}`}
        description={subtitle}
        actions={
          <>
            {staff && (
              <>
                <ButtonLink href="/movement/new" variant="secondary" icon={<LogOut className="size-4" aria-hidden />}>
                  Record movement
                </ButtonLink>
                {view === "personal" && (
                  <ButtonLink href="/leave" variant={can(user, "reports.view") ? "secondary" : "primary"} icon={<CalendarPlus className="size-4" aria-hidden />}>
                    Apply for leave
                  </ButtonLink>
                )}
              </>
            )}
            {can(user, "reports.view") && view === "org" && (
              <ButtonLink href="/reports" icon={<FileBarChart className="size-4" aria-hidden />}>
                Reports
              </ButtonLink>
            )}
          </>
        }
      />

      {tabs && (
        <Segmented
          className="self-start"
          items={[
            { href: withParams("/dashboard", sp, { view: "personal" }), label: "My day", active: view === "personal" },
            { href: withParams("/dashboard", sp, { view: "org" }), label: "Organisation", active: view === "org" },
          ]}
        />
      )}

      {view === "org" ? <OrgView user={user} canApprove={canApprove} /> : intern ? <InternView user={user} /> : <PersonalView user={user} />}
    </PageBody>
  );
}
