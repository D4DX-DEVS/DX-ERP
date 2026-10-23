import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/ui/actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { Alert, PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Td, Th, Tr } from "@/components/ui/table";
import { isStaff, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { workCalendar } from "@/lib/domain/calendar";
import { Attendance, AttendanceCorrection, LeaveRequest, Movement, type IAttendance } from "@/lib/models";
import type { SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { TONE_CLASSES } from "@/lib/status";
import { addDays, eachDay, formatDuration, fmtDate, fmtTime, monthKey, monthRange, todayKey, weekday } from "@/lib/time";
import { cn } from "@/lib/cn";
import { cancelCorrection } from "./actions";
import { CorrectionDialog } from "./_components/correction-dialog";
import { DayChips } from "./_components/day-chip";
import { MonthNav } from "./_components/month-nav";
import { AttendanceTabs } from "./_components/tabs";
import { attendanceAccess } from "./_lib/access";
import { currentTime } from "./_lib/clock";
import { decidableFilter } from "./_lib/corrections";
import { classifyDay, dayChipInfo, provisionalWork, summarizeDays, type DayClass, type DayKey } from "./_lib/day";
import { buildLeaveDayMap } from "./_lib/leave-days";
import { validMonthParam } from "./_lib/params";
import { TodayAttendanceCard } from "./today-card";

export const metadata = { title: "My attendance" };

interface LogMovement {
  id: string;
  no: string;
  minutes: number;
  official: boolean;
  open: boolean;
}

interface LogDay {
  date: string;
  att?: IAttendance;
  cls: DayClass;
  holidayName?: string;
  leaveLabel?: string;
  moves: LogMovement[];
  worked: number | null;
}

/** Calendar cell appearance per day status (design: Present / Late / Leave / Missing check-out / Holiday-weekend). */
function cellTone(key: DayKey): string {
  if (key === "weekend" || key === "holiday") return "bg-ground text-subtle";
  if (key === "upcoming" || key === "not_checked_in") return "border border-dashed border-line-strong bg-white text-subtle";
  const t = TONE_CLASSES[dayChipInfo(key).tone];
  return cn(t.bg, t.fg);
}

function cellNote(d: LogDay): string {
  switch (d.cls.key) {
    case "present":
    case "late":
    case "early":
    case "half_day":
      return d.worked ? formatDuration(d.worked) : "";
    case "in_progress":
      return d.worked ? formatDuration(d.worked) : "In";
    case "on_leave":
    case "half_leave":
      return "Leave";
    case "absent":
      return "Absent";
    case "missing_checkout":
      return "No out";
    case "holiday":
      return "Holiday";
    default:
      return "";
  }
}

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
  await connectDB();
  const settings = await getSettings();
  const access = await attendanceAccess(user);
  const now = currentTime();
  const today = todayKey();
  const thisMonth = monthKey(now);
  const requested = validMonthParam(sp, "month") ?? thisMonth;
  const month = requested > thisMonth ? thisMonth : requested;
  const { from, to } = monthRange(month);
  const last = to < today ? to : today;

  const [records, movements, leaves, cal, corrections, openDays, pendingForMe] = await Promise.all([
    Attendance.find({ user: user._id, date: { $gte: from, $lte: to } }).lean(),
    Movement.find(
      { user: user._id, date: { $gte: from, $lte: to }, status: { $in: ["out", "returned"] }, approvalStatus: { $ne: "rejected" } },
      { movementNo: 1, date: 1, status: 1, durationMinutes: 1, official: 1, outTime: 1 },
    ).lean(),
    LeaveRequest.find({ user: user._id, status: "approved", startDate: { $lte: to }, endDate: { $gte: from } }, { user: 1, startDate: 1, endDate: 1, halfDay: 1, leaveTypeName: 1 }).lean(),
    workCalendar(settings, from, to),
    AttendanceCorrection.find({ user: user._id }).sort({ createdAt: -1 }).limit(8).lean(),
    Attendance.find({ user: user._id, checkIn: { $ne: null }, checkOut: null, date: { $lt: today, $gte: addDays(today, -60) } }, { date: 1, checkIn: 1 }).sort({ date: -1 }).lean(),
    access.canDecide ? AttendanceCorrection.countDocuments({ status: "pending", ...decidableFilter(user, access) }) : Promise.resolve(0),
  ]);

  const leaveMap = buildLeaveDayMap(leaves, settings, cal, from, to).get(user.id);
  const recByDate = new Map(records.map((r) => [r.date, r]));
  const movesByDate = new Map<string, typeof movements>();
  for (const m of movements) movesByDate.set(m.date, [...(movesByDate.get(m.date) ?? []), m]);

  const days: LogDay[] = eachDay(from, to).map((date) => {
    const att = recByDate.get(date);
    const l = leaveMap?.get(date);
    const cls = classifyDay({ date, today, now, att, leave: l ? (l.half ? "half" : "full") : null, holiday: cal.isHoliday(date), settings });
    const dayMoves = movesByDate.get(date) ?? [];
    let worked: number | null = null;
    if (att?.checkIn) {
      if (att.checkOut) worked = att.workMinutes;
      else if (date === today && cls.key === "in_progress") worked = provisionalWork({ date, checkIn: att.checkIn, checkOut: null, breaks: att.breaks }, dayMoves, settings, now);
    }
    return {
      date,
      att,
      cls,
      holidayName: cal.holidays.get(date),
      leaveLabel: l?.typeName,
      worked,
      moves: dayMoves.map((m) => ({
        id: m._id.toString(),
        no: m.movementNo,
        minutes: m.durationMinutes ?? 0,
        official: m.official,
        open: m.status === "out",
      })),
    };
  });

  const elapsed = days.filter((d) => d.date <= last);
  const stats = summarizeDays(elapsed.map((d) => ({ key: d.cls.key, att: d.att })));
  const pendingDates = new Set(corrections.filter((c) => c.status === "pending").map((c) => c.date));
  const missing = [
    ...openDays.map((r) => r.date),
    ...(recByDate.get(today) && days.find((d) => d.date === today)?.cls.key === "missing_checkout" ? [today] : []),
  ].sort((x, y) => (x < y ? 1 : -1));
  const lead = (weekday(from) + 6) % 7;
  const a = settings.attendance;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
            action={
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2" aria-hidden>
                {(
                  [
                    ["Present", "green"],
                    ["Late", "amber"],
                    ["Leave", "blue"],
                    ["Missing check-out", "orange"],
                    ["Absent", "red"],
                    ["Holiday / weekend", "gray"],
                  ] as const
                ).map(([label, tone]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span className={cn("size-2.5 rounded-[3px]", TONE_CLASSES[tone].dot)} />
                    {label}
                  </span>
                ))}
              </div>
            }
          />
          <CardBody>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <span key={d} className="py-1 text-center text-xs font-semibold text-muted">
                  {d}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {days.map((d) => (
                <div
                  key={d.date}
                  title={`${fmtDate(d.date, "EEE d MMM")} · ${dayChipInfo(d.cls.key).label}${d.holidayName ? ` · ${d.holidayName}` : ""}`}
                  className={cn(
                    "flex min-h-12 flex-col justify-between rounded-[10px] p-1 text-[10px] sm:min-h-[58px] sm:px-2 sm:py-1.5 sm:text-[11px]",
                    cellTone(d.cls.key),
                    d.date === today && "ring-2 ring-brand-500",
                  )}
                >
                  <span className="text-xs font-semibold">{Number(d.date.slice(8))}</span>
                  <span className="truncate">{cellNote(d)}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Correction requests" />
            <CardBody className="pb-3">
              {corrections.length === 0 ? (
                <p className="text-[13px] text-muted">No correction requests yet. Use &ldquo;Request correction&rdquo; when a time is missing or wrong.</p>
              ) : (
                <ul className="flex flex-col">
                  {corrections.map((c) => (
                    <li key={c._id.toString()} className="flex flex-col gap-1 border-t border-line-soft py-2.5 text-[13px] first:border-t-0 first:pt-0">
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
                          <ActionButton action={cancelCorrection.bind(null, c._id.toString())} variant="ghost" size="sm" confirmTone="danger" confirmTitle="Cancel request" confirmLabel="Cancel request" confirm="Cancel this correction request?" successMessage="Request cancelled">
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
