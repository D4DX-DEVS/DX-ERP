import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { Alert, PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { isStaff, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { leaveBalances, leaveYearOf } from "@/lib/domain/leave-balance";
import { Attendance, AttendanceCorrection } from "@/lib/models";
import type { SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { addDays, formatDuration, fmtDate, fmtTime, monthKey, todayKey } from "@/lib/time";
import { cn } from "@/lib/cn";
import { cancelCorrection } from "./actions";
import { CorrectionDialog } from "./_components/correction-dialog";
import { DayChips } from "./_components/day-chip";
import { MonthNav } from "./_components/month-nav";
import { AttendanceTabs } from "./_components/tabs";
import { attendanceAccess } from "./_lib/access";
import { currentTime } from "./_lib/clock";
import { decidableFilter } from "./_lib/corrections";
import { loadMonthLog, type LogMovement } from "./_lib/month";
import { CalendarLegend, MonthCalendar } from "./_components/month-calendar";
import { LeaveBalanceCard } from "../leave/_components/balance-card";
import { validMonthParam } from "./_lib/params";
import { TodayAttendanceCard } from "./today-card";

export const metadata = { title: "My attendance" };

function MovementLinks({ moves }: { moves: LogMovement[] }) {
  if (moves.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {moves.map((m) => (
        <Link key={m.id} href={`/movement/${m.id}`} title={m.no} className={cn("font-medium hover:underline", m.open ? "text-outside" : "text-brand-600")}>
          {m.open ? "Out now" : formatDuration(m.minutes)}
        </Link>
      ))}
    </span>
  );
}

export default async function MyAttendancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  if (!isStaff(user)) redirect("/attendance/team");
  const sp = await searchParams;
  const settings = await getSettings();
  const access = await attendanceAccess(user);
  const now = currentTime();
  const today = todayKey();
  const thisMonth = monthKey(now);
  const requested = validMonthParam(sp, "month") ?? thisMonth;
  const month = requested > thisMonth ? thisMonth : requested;

  const year = leaveYearOf(today, settings);
  const [log, corrections, openDays, pendingForMe, balances] = await Promise.all([
    loadMonthLog(user._id, month, settings, today, now),
    db().select().from(AttendanceCorrection).where(eq(AttendanceCorrection.user, user._id)).orderBy(desc(AttendanceCorrection.createdAt)).limit(8),
    db()
      .select({ date: Attendance.date, checkIn: Attendance.checkIn })
      .from(Attendance)
      .where(
        and(
          eq(Attendance.user, user._id),
          isNotNull(Attendance.checkIn),
          isNull(Attendance.checkOut),
          lt(Attendance.date, today),
          gte(Attendance.date, addDays(today, -60)),
        ),
      )
      .orderBy(desc(Attendance.date)),
    access.canDecide ? db().$count(AttendanceCorrection, and(eq(AttendanceCorrection.status, "pending"), decidableFilter(user, access))) : Promise.resolve(0),
    leaveBalances(user._id, user.personType, year, settings, today),
  ]);

  const { days, elapsed, stats } = log;
  const recByDate = new Map(days.flatMap((d) => (d.att ? [[d.date, d.att] as const] : [])));
  const pendingDates = new Set(corrections.filter((c) => c.status === "pending").map((c) => c.date));
  const missing = [
    ...openDays.map((r) => r.date),
    ...(recByDate.get(today) && days.find((d) => d.date === today)?.cls.key === "missing_checkout" ? [today] : []),
  ].sort((x, y) => (x < y ? 1 : -1));
  const a = settings.attendance;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const saturdaysOff = a.workingDays.includes(6) ? a.saturdaysOff.map((n) => ["1st", "2nd", "3rd", "4th", "5th"][n - 1]).join(" & ") : "";

  return (
    <PageBody>
      <PageHeader
        overline="Time"
        title="My attendance"
        actions={
          <>
            <MonthNav basePath="/attendance" month={month} maxMonth={thisMonth} />
            <CorrectionDialog today={today} trigger={<Button icon={<Plus className="size-4" />}>Request correction</Button>} />
          </>
        }
      />
      <AttendanceTabs active="me" access={access} pendingCorrections={pendingForMe} />

      <TodayAttendanceCard userId={user.id} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Present" value={<>{stats.present}<span className="ml-1 text-sm font-medium text-muted">/ {stats.workingDays} days</span></>} />
        <StatCard label="Average day" value={stats.workedDays ? formatDuration(stats.workMinutes / stats.workedDays) : "—"} sub={`${formatDuration(stats.workMinutes)} total`} />
        <StatCard label="Late arrivals" value={stats.lateCount} />
        <StatCard label="Half days" value={stats.halfDays} />
        <StatCard label="Absent" value={stats.absent} tone={stats.absent ? "alert" : "default"} />
        <StatCard label="Leave taken" value={stats.leaveDays} />
        <StatCard label="Missing check-out" value={stats.missingCheckout} tone={stats.missingCheckout ? "alert" : "default"} />
      </div>

      {missing.length > 0 && (
        <div className="flex flex-col gap-2">
          {missing.slice(0, 4).map((date) => (
            <Alert
              key={date}
              tone="outside"
              title={`No check-out on ${fmtDate(date, "EEE d MMM")}.`}
              action={
                pendingDates.has(date) ? (
                  <span className="shrink-0 text-xs font-semibold">Correction pending</span>
                ) : (
                  <CorrectionDialog
                    today={today}
                    defaultDate={date}
                    hint={`Checked in at ${fmtTime(recByDate.get(date)?.checkIn ?? openDays.find((r) => r.date === date)?.checkIn)}. Enter the time you actually left.`}
                    trigger={
                      <Button size="sm" variant="secondary">
                        Request correction
                      </Button>
                    }
                  />
                )
              }
            >
              Hours for that day stay provisional until a correction is approved.
            </Alert>
          ))}
          {missing.length > 4 && <p className="text-xs text-muted">+ {missing.length - 4} more days without a check-out.</p>}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={fmtDate(`${month}-01`, "MMMM")}
            action={<CalendarLegend />}
          />
          <CardBody>
            <MonthCalendar days={days} today={today} />
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <LeaveBalanceCard balances={balances} />
          <Card>
            <CardHeader title="Correction requests" />
            <CardBody className="pb-3">
              {corrections.length === 0 ? (
                <p className="text-[13px] text-muted">No correction requests yet. Use &ldquo;Request correction&rdquo; when a time is missing or wrong.</p>
              ) : (
                <ul className="flex flex-col">
                  {corrections.map((c) => (
                    <li key={c._id} className="flex flex-col gap-1 border-t border-line-soft py-2.5 text-[13px] first:border-t-0 first:pt-0">
                      <div className="flex items-start justify-between gap-2">
                        <strong className="font-semibold text-ink">
                          {fmtDate(c.date, "EEE d MMM")} ·{" "}
                          {[c.requestedCheckIn && "check-in", c.requestedCheckOut && "check-out"].filter(Boolean).join(" & ")}
                        </strong>
                        <StatusChip domain="correction" value={c.status} size="sm" />
                      </div>
                      <div className="text-muted">
                        {c.requestedCheckIn && <>In {fmtTime(c.original.checkIn)} → {fmtTime(c.requestedCheckIn)}. </>}
                        {c.requestedCheckOut && <>Out {fmtTime(c.original.checkOut)} → {fmtTime(c.requestedCheckOut)}. </>}
                        {c.reason}
                      </div>
                      {c.reviewerName && c.status !== "pending" && (
                        <div className="text-xs text-muted">
                          {c.status === "approved" ? "Approved" : "Rejected"} by {c.reviewerName}
                          {c.reviewNote ? ` — ${c.reviewNote}` : ""}
                        </div>
                      )}
                      {c.status === "pending" && (
                        <div>
                          <ActionButton action={cancelCorrection.bind(null, c._id)} variant="ghost" size="sm" confirmTone="danger" confirmTitle="Cancel request" confirmLabel="Cancel request" confirm="Cancel this correction request?" successMessage="Request cancelled">
                            Cancel request
                          </ActionButton>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <section className="flex flex-col gap-1.5 rounded-[14px] bg-brand-50 px-[18px] py-4 text-[13px] text-brand-700">
            <strong>Your policy</strong>
            <span>
              Office hours {a.officeStart} – {a.officeEnd} · {a.workingDays.map((d) => dayNames[d]).join(", ")}
              {saturdaysOff && ` (${saturdaysOff} Saturday off)`}
            </span>
            <span>
              Grace period {a.graceMinutes} min · full day {formatDuration(a.fullDayMinutes)} · half day {formatDuration(a.halfDayMinutes)}
            </span>
            <span>
              Movements don&apos;t end your working day.
              {a.officialMovementCountsAsWork ? " Official movement counts as work time." : " Official movement time is not counted as work."}
              {a.personalMovementDeducted ? " Personal movement time is deducted." : ""}
            </span>
          </section>
        </div>
      </div>

      <Card>
        <CardHeader title="Daily log" subtitle={`${fmtDate(`${month}-01`, "MMMM yyyy")} · ${elapsed.length} days`} />
        <TableWrap phone={[1, 2, 3, "last"]} tablet={[1, 2, 3, 8, "last"]}>
          <THead>
            <Th>Date</Th>
            <Th>Check-in</Th>
            <Th>Check-out</Th>
            <Th>Break</Th>
            <Th>Official out</Th>
            <Th>Personal out</Th>
            <Th>Late / early</Th>
            <Th>Worked</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {elapsed.length === 0 && <EmptyRow colSpan={9}>This month hasn&apos;t started yet.</EmptyRow>}
            {[...elapsed].reverse().map((d) => {
              const quiet = d.cls.key === "weekend" || d.cls.key === "holiday";
              return (
                <Tr key={d.date} className={cn(quiet && "bg-field/60")}>
                  <Td className="font-semibold whitespace-nowrap">
                    {fmtDate(d.date, "EEE d MMM")}
                    {(d.holidayName || d.leaveLabel) && <div className="text-xs font-normal text-muted">{d.holidayName ?? d.leaveLabel}</div>}
                  </Td>
                  <Td className="tabular">{d.att?.checkIn ? fmtTime(d.att.checkIn) : <span className="text-muted">—</span>}</Td>
                  <Td className="tabular">{d.att?.checkOut ? fmtTime(d.att.checkOut) : <span className="text-muted">—</span>}</Td>
                  <Td className="tabular">{d.att?.checkIn ? formatDuration(d.att.breakMinutes) : <span className="text-muted">—</span>}</Td>
                  <Td>
                    <MovementLinks moves={d.moves.filter((m) => m.official)} />
                  </Td>
                  <Td>
                    <MovementLinks moves={d.moves.filter((m) => !m.official)} />
                  </Td>
                  <Td className="text-xs">
                    {d.att?.late && <div className="font-semibold text-tone-amber">Late {d.att.lateMinutes}m</div>}
                    {d.att?.checkOut && d.att.earlyDeparture && <div className="font-semibold text-tone-amber">Early {d.att.earlyMinutes}m</div>}
                    {!(d.att?.late || (d.att?.checkOut && d.att.earlyDeparture)) && <span className="text-muted">—</span>}
                  </Td>
                  <Td className="font-semibold tabular">
                    {d.worked != null ? (
                      <>
                        {formatDuration(d.worked)}
                        {!d.att?.checkOut && <span className="ml-1 text-xs font-normal text-muted">so far</span>}
                      </>
                    ) : d.cls.key === "missing_checkout" ? (
                      <span className="text-xs font-normal text-muted">Provisional</span>
                    ) : (
                      <span className="font-normal text-muted">—</span>
                    )}
                  </Td>
                  <Td>
                    <DayChips cls={d.cls} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

    </PageBody>
  );
}
