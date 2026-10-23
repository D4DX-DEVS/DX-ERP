import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { workCalendar } from "@/lib/domain/calendar";
import { LeaveRequest, LeaveType, User, type LeaveStatus } from "@/lib/models";
import type { SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { cn } from "@/lib/cn";
import { addDays, eachDay, fmtDate, monthKey, monthRange, todayKey, weekday } from "@/lib/time";
import { MonthNav } from "../../attendance/_components/month-nav";
import { leaveDaysIn } from "../../attendance/_lib/leave-days";
import { EXITED_STATUSES, STAFF_TYPES } from "../../attendance/_lib/access";
import { validMonthParam } from "../../attendance/_lib/params";
import { LeaveTabs } from "../_components/tabs";
import { leaveAccess } from "../_lib/access";

export const metadata = { title: "Team leave calendar" };

const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;
const PENDING_HATCH = "repeating-linear-gradient(45deg, #c4d0f7 0 3px, #ffffff 3px 6px)";

interface Cell {
  pending: boolean;
  half: boolean;
  session?: string;
  typeName: string;
  color?: string;
}

export default async function LeaveCalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const access = await leaveAccess(user);
  const sp = await searchParams;
  await connectDB();
  const settings = await getSettings();
  const today = todayKey();
  const month = validMonthParam(sp, "month") ?? monthKey();
  const { from, to } = monthRange(month);
  const days = eachDay(from, to);

  // Scope: org-wide for leave.view_all; managers see their reports (and themselves, including pending requests);
  // everyone else sees approved leave of their own department (names and dates only — never reasons).
  let scopeLabel: string;
  let userScope: Record<string, unknown> = {};
  let statuses: LeaveStatus[] = ["approved", "pending_manager", "pending_hr"];
  if (access.viewAll) {
    scopeLabel = "Everyone · approved and pending leave";
  } else if (access.isManager) {
    scopeLabel = "You and your reports · approved and pending leave";
    userScope = { user: { $in: [user.id, ...access.reportIds] } };
  } else {
    scopeLabel = user.departmentName ? `${user.departmentName} · approved leave` : "Your approved leave";
    statuses = ["approved"];
    const mates = user.departmentId
      ? await User.find({ department: user.departmentId, personType: { $in: STAFF_TYPES }, status: { $nin: EXITED_STATUSES } }, { _id: 1 }).lean()
      : [];
    userScope = { user: { $in: [user.id, ...mates.map((m) => m._id.toString())] } };
  }

  const [requests, cal, types] = await Promise.all([
    LeaveRequest.find({ ...userScope, status: { $in: statuses }, startDate: { $lte: to }, endDate: { $gte: from } }, { user: 1, leaveType: 1, leaveTypeName: 1, startDate: 1, endDate: 1, halfDay: 1, halfDaySession: 1, status: 1 }).lean(),
    workCalendar(settings, from, to),
    LeaveType.find({}, { color: 1 }).lean(),
  ]);
  const colorOf = new Map(types.map((t) => [t._id.toString(), t.color && SAFE_COLOR.test(t.color) ? t.color : undefined]));

  const byUser = new Map<string, Map<string, Cell>>();
  for (const r of requests) {
    const start = r.startDate > from ? r.startDate : from;
    const end = r.endDate < to ? r.endDate : to;
    const key = r.user.toString();
    const cells = byUser.get(key) ?? new Map<string, Cell>();
    for (const d of leaveDaysIn(settings, cal, start, end)) {
      cells.set(d, { pending: r.status !== "approved", half: r.halfDay, session: r.halfDaySession, typeName: r.leaveTypeName ?? "Leave", color: colorOf.get(r.leaveType.toString()) });
    }
    byUser.set(key, cells);
  }
  const people = await User.find({ _id: { $in: [...byUser.keys()] } }, { name: 1, employeeId: 1 }).sort({ name: 1 }).lean();
  const rows = people.filter((p) => (byUser.get(p._id.toString())?.size ?? 0) > 0);
  const outToday = today >= from && today <= to ? rows.filter((p) => byUser.get(p._id.toString())?.get(today) && !byUser.get(p._id.toString())?.get(today)?.pending) : [];

  // Fluid: the day columns share whatever width there is, so the grid never scrolls sideways.
  const cols = `minmax(88px, 176px) repeat(${days.length}, minmax(0, 1fr))`;
  const dim = (d: string) => !settings.attendance.workingDays.includes(weekday(d)) || cal.isHoliday(d);
  /** Phones: each person's leave as date ranges (weekends / holidays inside a range don't split it). */
  const rangesOf = (cells: Map<string, Cell> | undefined) => {
    const out: { start: string; end: string; cell: Cell }[] = [];
    for (const d of [...(cells?.keys() ?? [])].sort()) {
      const c = cells!.get(d)!;
      const last = out.at(-1);
      let next = last ? addDays(last.end, 1) : "";
      while (last && next < d && dim(next)) next = addDays(next, 1);
      if (last && next === d && last.cell.typeName === c.typeName && last.cell.pending === c.pending) last.end = d;
      else out.push({ start: d, end: d, cell: c });
    }
    return out;
  };

  return (
    <PageBody>
      <PageHeader overline="Time" title="Team leave calendar" description={scopeLabel} actions={<MonthNav basePath="/leave/calendar" month={month} />} />
      <LeaveTabs active="calendar" access={access} />

      <Card>
        <CardHeader
          title={fmtDate(`${month}-01`, "MMMM yyyy")}
          subtitle={`${rows.length} ${rows.length === 1 ? "person" : "people"} on leave this month`}
          action={
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-2" aria-hidden>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-3.5 rounded-[3px] bg-brand-500" />
                Approved
              </span>
              {statuses.length > 1 && (
                <span className="flex items-center gap-1.5">
                  <span className="box-border h-2.5 w-3.5 rounded-[3px] border border-brand-500" style={{ background: PENDING_HATCH }} />
                  Pending
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-3.5 rounded-[3px] bg-field ring-1 ring-line" />
                Weekend / holiday
              </span>
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="No leave this month" description="Nobody in this view has leave in the selected month." />
        ) : (
          <CardBody>
            <ul className="flex flex-col divide-y divide-line-soft md:hidden">
              {rows.map((p) => (
                <li key={p._id.toString()} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="text-[13px] font-semibold text-ink">{p.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {rangesOf(byUser.get(p._id.toString())).map((r) => (
                      <span key={r.start} className="inline-flex items-center gap-1.5 rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-ink-2">
                        <span
                          className={cn("size-2 shrink-0 rounded-full", r.cell.pending ? "border border-brand-500" : !r.cell.color && "bg-brand-500")}
                          style={r.cell.pending ? { background: PENDING_HATCH } : r.cell.color ? { background: r.cell.color } : undefined}
                          aria-hidden
                        />
                        {r.start === r.end ? fmtDate(r.start, "EEE d MMM") : `${fmtDate(r.start, "d MMM")} – ${fmtDate(r.end, "d MMM")}`} · {r.cell.typeName}
                        {r.cell.half ? " (half)" : ""}
                        {r.cell.pending ? " · pending" : ""}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <div className="max-md:hidden">
              <div role="table" aria-label={`Leave in ${fmtDate(`${month}-01`, "MMMM yyyy")}`}>
                <div className="grid gap-0.5 pb-1.5 text-center text-[11px] text-muted" style={{ gridTemplateColumns: cols }} role="row">
                  <span className="sticky left-0 z-10 bg-white" />
                  {days.map((d) => (
                    <span key={d} role="columnheader" title={cal.holidays.get(d) ?? fmtDate(d, "EEEE d MMM")} className={cn("rounded py-0.5", dim(d) && "bg-field", d === today && "bg-brand-100 font-bold text-brand-600")}>
                      {fmtDate(d, "EEEEE")}
                      <br />
                      {Number(d.slice(8))}
                    </span>
                  ))}
                </div>
                {rows.map((p) => {
                  const cells = byUser.get(p._id.toString());
                  return (
                    <div key={p._id.toString()} className="grid items-center gap-0.5 border-t border-line-soft py-1" style={{ gridTemplateColumns: cols }} role="row">
                      <span role="rowheader" className="sticky left-0 z-10 truncate bg-white pr-2 text-[13px] font-medium text-ink" title={p.name}>
                        {p.name}
                      </span>
                      {days.map((d) => {
                        const c = cells?.get(d);
                        return (
                          <span key={d} role="cell" className={cn("flex h-[22px] items-center", dim(d) && "bg-field", c?.half && c.session === "second" ? "justify-end" : "justify-start")}>
                            {c && (
                              <span
                                title={`${p.name} · ${c.typeName}${c.half ? ` · ${c.session === "second" ? "2nd" : "1st"} half` : ""} · ${fmtDate(d, "EEE d MMM")}${c.pending ? " (pending)" : ""}`}
                                className={cn("box-border block h-full rounded-[5px]", c.half ? "w-1/2" : "w-full", c.pending ? "border border-brand-500" : !c.color && "bg-brand-500")}
                                style={c.pending ? { background: PENDING_HATCH } : c.color ? { background: c.color } : undefined}
                              />
                            )}
                          </span>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardBody>
        )}
      </Card>

      {outToday.length > 0 && (
        <Card>
          <CardHeader title="On leave today" subtitle={fmtDate(today, "EEEE d MMMM")} />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {outToday.map((p) => (
                <li key={p._id.toString()} className="rounded-full bg-tone-blue-bg px-3 py-1 text-[13px] font-medium text-tone-blue">
                  {p.name} · {byUser.get(p._id.toString())?.get(today)?.typeName}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </PageBody>
  );
}
