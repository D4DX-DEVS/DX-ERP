import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { can } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { leaveBalances, leaveYearOf, leaveYearRange } from "@/lib/domain/leave-balance";
import { LeaveRequest } from "@/lib/models";
import { fmtDate, formatDuration, timeAgo } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { StatCard } from "@/components/ui/page";
import { CalendarLegend, MonthCalendar } from "../../../attendance/_components/month-calendar";
import { MonthNav } from "../../../attendance/_components/month-nav";
import { currentTime } from "../../../attendance/_lib/clock";
import { loadMonthLog } from "../../../attendance/_lib/month";
import { LeaveBalanceCard } from "../../../leave/_components/balance-card";
import { daysLabel, leaveRangeLabel } from "../../../leave/_lib/format";
import type { TabProps } from "./types";

/** Month attendance calendar, leave balances and recent leave requests of one person (HR, managers, mentors, self). */
export async function AttendanceTab({ user, person, settings, today, month, thisMonth }: TabProps & { month: string; thisMonth: string }) {
  const year = leaveYearOf(today, settings);
  const range = leaveYearRange(year, settings);
  const [log, balances, requests] = await Promise.all([
    loadMonthLog(person._id, month, settings, today, currentTime()),
    leaveBalances(person._id, person.personType, year, settings, today),
    db()
      .select({
        _id: LeaveRequest._id,
        requestNo: LeaveRequest.requestNo,
        leaveTypeName: LeaveRequest.leaveTypeName,
        startDate: LeaveRequest.startDate,
        endDate: LeaveRequest.endDate,
        halfDay: LeaveRequest.halfDay,
        halfDaySession: LeaveRequest.halfDaySession,
        days: LeaveRequest.days,
        status: LeaveRequest.status,
        createdAt: LeaveRequest.createdAt,
      })
      .from(LeaveRequest)
      .where(eq(LeaveRequest.user, person._id))
      .orderBy(desc(LeaveRequest.createdAt))
      .limit(8),
  ]);
  const { stats } = log;
  const canManageLeave = can(user, "leave.manage");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav basePath={`/staff/${person._id}`} month={month} maxMonth={thisMonth} params={{ tab: "attendance" }} />
        {can(user, "attendance.view_all") && (
          <Link href={`/attendance/summary?month=${month}&q=${encodeURIComponent(person.employeeId)}`} className="text-[13px] font-semibold text-brand-600 hover:underline">
            Team summary for {fmtDate(`${month}-01`, "MMMM")} →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Present" value={<>{stats.present}<span className="ml-1 text-sm font-medium text-muted">/ {stats.workingDays}</span></>} />
        <StatCard label="Absent" value={stats.absent} tone={stats.absent ? "alert" : "default"} />
        <StatCard label="Leave taken" value={stats.leaveDays} />
        <StatCard label="Late arrivals" value={stats.lateCount} />
        <StatCard label="Half days" value={stats.halfDays} />
        <StatCard label="Average day" value={stats.workedDays ? formatDuration(stats.workMinutes / stats.workedDays) : "—"} sub={`${formatDuration(stats.workMinutes)} total`} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={fmtDate(`${month}-01`, "MMMM yyyy")} action={<CalendarLegend />} />
          <CardBody>
            <MonthCalendar days={log.days} today={today} />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <LeaveBalanceCard
            balances={balances}
            title={`Leave balance · ${fmtDate(range.from, "MMM yyyy")} – ${fmtDate(range.to, "MMM yyyy")}`}
            href={canManageLeave ? `/leave/balances?q=${encodeURIComponent(person.employeeId)}` : null}
            linkLabel="Adjust →"
          />
          <Card>
            <CardHeader title="Recent leave requests" />
            <CardBody className="pb-3">
              {requests.length === 0 ? (
                <p className="text-[13px] text-muted">No leave requests yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {requests.map((r) => (
                    <li key={r._id} className="flex items-start justify-between gap-3 border-t border-line-soft py-2.5 text-[13px] first:border-t-0 first:pt-0">
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink">{leaveRangeLabel(r)}</span>
                        <span className="block text-xs text-muted">
                          {r.leaveTypeName} · {daysLabel(r.days)} · {r.requestNo} · {timeAgo(r.createdAt)}
                        </span>
                      </span>
                      <StatusChip domain="leave" value={r.status} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
