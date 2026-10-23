import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Progress } from "@/components/ui/page";
import type { Tone } from "@/lib/config-defaults";
import { connectDB } from "@/lib/db";
import { Attendance, Holiday, LeaveRequest, Movement } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { addDays, fmtDate, fmtTime, formatDuration, hmToMinutes, minutesBetween, todayKey, weekStart, weekday } from "@/lib/time";
import { LiveDuration } from "./_components/live-duration";
import { TodayActions, type TodayState } from "./_components/today-actions";
import { currentTime } from "./_lib/clock";
import { classifyDay, dayChipInfo, provisionalWork } from "./_lib/day";

function minutesToHm(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Dashboard "Today" card (FRS §4.2, §7.1): status, check-in / check-out, worked so far, progress against the
 * daily target, the check-in / break / check-out buttons, and a compact "This week" bar list.
 */
export async function TodayAttendanceCard({ userId }: { userId: string }) {
  await connectDB();
  const settings = await getSettings();
  const a = settings.attendance;
  const now = currentTime();
  const today = todayKey();
  const from = weekStart(today);
  const to = addDays(from, 6);

  const [att, openMovement, leave, holiday, weekAtt, weekMoves] = await Promise.all([
    Attendance.findOne({ user: userId, date: today }).lean(),
    Movement.findOne({ user: userId, status: "out" }, { categoryLabel: 1, official: 1, outTime: 1 }).sort({ outTime: -1 }).lean(),
    LeaveRequest.findOne({ user: userId, status: "approved", startDate: { $lte: today }, endDate: { $gte: today } }, { halfDay: 1 }).lean(),
    Holiday.exists({ date: today, optional: false }),
    Attendance.find({ user: userId, date: { $gte: from, $lte: to } }).lean(),
    Movement.find(
      { user: userId, date: { $gte: from, $lte: to }, status: { $in: ["out", "returned"] }, approvalStatus: { $ne: "rejected" } },
      { date: 1, status: 1, official: 1, durationMinutes: 1, outTime: 1 },
    ).lean(),
  ]);

  // Leave only counts on days that are leave days (working days, unless weekends count).
  const countsAsLeaveDay = settings.leave.countWeekendsInLeave || (a.workingDays.includes(weekday(today)) && !holiday);
  const leaveToday = leave && countsAsLeaveDay ? (leave.halfDay ? "half" : "full") : null;
  const cls = classifyDay({ date: today, today, now, att, leave: leaveToday, holiday: Boolean(holiday), settings });

  const open = Boolean(att?.checkIn && !att.checkOut);
  const onBreak = open && Boolean(att?.breaks.some((b) => !b.end));
  const todayMoves = weekMoves.filter((m) => m.date === today);
  const worked = att?.checkIn ? (att.checkOut ? att.workMinutes : provisionalWork({ date: today, checkIn: att.checkIn, checkOut: null, breaks: att.breaks }, todayMoves, settings, now)) : 0;
  const clockStopped =
    onBreak ||
    Boolean(openMovement && (openMovement.official ? !a.officialMovementCountsAsWork : a.personalMovementDeducted));
  const running = open && !clockStopped;

  let state: TodayState;
  let note: string | undefined;
  if (att?.checkIn) state = att.checkOut ? "done" : onBreak ? "on_break" : "working";
  else if (leaveToday === "full") {
    state = "unavailable";
    note = "You're on approved leave today.";
  } else if (!a.allowSelfCheckIn) {
    state = "unavailable";
    note = "Self check-in is turned off. Ask HR to record your attendance.";
  } else state = "can_check_in";

  const breakSoFar = (att?.breaks ?? []).reduce((s, b) => s + minutesBetween(b.start, b.end ?? now), 0);
  const expectedOut = att?.checkIn ? new Date(att.checkIn.getTime() + (a.fullDayMinutes + breakSoFar) * 60_000) : null;
  const graceEnd = minutesToHm(hmToMinutes(a.officeStart) + a.graceMinutes);
  const pct = a.fullDayMinutes > 0 ? (worked / a.fullDayMinutes) * 100 : 0;

  // Primary status chip (design: "Present · on time") + presence chip (In office / Out / On break / Checked out).
  let primary: { label: string; tone: Tone };
  if (att?.checkIn && att.late && (cls.key === "in_progress" || cls.key === "late")) primary = { label: `Late · ${att.lateMinutes}m`, tone: "amber" };
  else if (att?.checkIn && (cls.key === "in_progress" || cls.key === "present")) primary = { label: "Present · on time", tone: "green" };
  else primary = dayChipInfo(cls.key);

  let presence: { label: string; tone: Tone } | null = null;
  if (openMovement?.outTime) presence = { label: `Out · ${openMovement.official ? openMovement.categoryLabel : "movement"} since ${fmtTime(openMovement.outTime)}`, tone: "orange" };
  else if (onBreak) presence = { label: "On break", tone: "amber" };
  else if (open) presence = { label: "In office", tone: "blue" };
  else if (att?.checkOut) presence = { label: `Checked out ${fmtTime(att.checkOut)}`, tone: "gray" };

  // This week: one row per working day, office hours vs official movement time.
  const weekAttByDate = new Map(weekAtt.map((r) => [r.date, r]));
  const week = Array.from({ length: 7 }, (_, i) => addDays(from, i))
    .filter((d) => a.workingDays.includes(weekday(d)))
    .map((d) => {
      const rec = weekAttByDate.get(d);
      const dayMoves = weekMoves.filter((m) => m.date === d);
      let total: number | null = null;
      if (rec?.checkIn) {
        if (rec.checkOut) total = rec.workMinutes;
        else if (d === today) total = worked;
      }
      const official = a.officialMovementCountsAsWork ? dayMoves.filter((m) => m.official && m.status === "returned").reduce((s, m) => s + (m.durationMinutes ?? 0), 0) : 0;
      return { date: d, total, official: Math.min(official, total ?? 0), future: d > today, isToday: d === today };
    });
  const scale = Math.max(a.fullDayMinutes, ...week.map((w) => w.total ?? 0), 1);

  return (
    <Card className="flex flex-wrap gap-6 p-5 sm:p-[22px] lg:gap-7">
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-[17px] font-semibold text-ink">Today</h2>
          <Chip tone={primary.tone}>{primary.label}</Chip>
          {presence && (
            <Chip tone={presence.tone} dot={false}>
              {presence.label}
            </Chip>
          )}
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-muted">Check-in</div>
            <div className="font-display text-2xl font-semibold tabular">{att?.checkIn ? fmtTime(att.checkIn) : <span className="text-subtle">—</span>}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Check-out</div>
            <div className="font-display text-2xl font-semibold tabular">{att?.checkOut ? fmtTime(att.checkOut) : <span className="text-subtle">—</span>}</div>
          </div>
          <div>
            <div className="text-xs text-muted">{att?.checkOut ? "Worked" : "Worked so far"}</div>
            <div className="font-display text-2xl font-semibold tabular">
              {att?.checkIn ? <LiveDuration baseMinutes={worked} renderedAt={now.getTime()} running={running} /> : <span className="text-subtle">—</span>}
            </div>
          </div>
        </div>

        {att?.checkIn && (
          <div className="flex flex-col gap-1.5">
            <Progress value={pct} tone={pct >= 100 ? "green" : "brand"} />
            <div className="flex flex-wrap justify-between gap-x-3 text-xs text-muted">
              <span>{fmtTime(att.checkIn)} in</span>
              <span>
                Target {formatDuration(a.fullDayMinutes)} · grace until {graceEnd}
              </span>
              <span>{att.checkOut ? `${fmtTime(att.checkOut)} out` : expectedOut ? `~${fmtTime(expectedOut)} out` : ""}</span>
            </div>
          </div>
        )}

        <TodayActions state={state} openMovementId={openMovement?._id.toString()} unavailableNote={note} />
        {state === "can_check_in" && (holiday || cls.key === "weekend") && <p className="text-xs text-muted">Today is a {holiday ? "holiday" : "weekend"}. Check in only if you are working.</p>}
      </div>

      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2.5 md:border-l md:border-line-soft md:pl-6">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold text-ink-2">This week</div>
          <Link href="/attendance" className="text-xs font-semibold text-brand-600 hover:text-brand-800">
            Month view →
          </Link>
        </div>
        {week.map((d) => (
          <div key={d.date} className="flex items-center gap-2.5 text-xs">
            <span className={d.isToday ? "w-8 font-bold text-brand-600" : "w-8 font-semibold text-ink-2"} title={fmtDate(d.date)}>
              {fmtDate(d.date, "EEE")}
            </span>
            <span className="flex h-3 min-w-0 flex-1 gap-0.5 overflow-hidden rounded bg-ground" role="img" aria-label={d.total ? `${formatDuration(d.total)} worked` : "No hours"}>
              {d.total ? (
                <>
                  <span className="h-full bg-chart-1" style={{ width: `${((d.total - d.official) / scale) * 100}%` }} />
                  {d.official > 0 && <span className="h-full bg-chart-2" style={{ width: `${(d.official / scale) * 100}%` }} />}
                </>
              ) : null}
            </span>
            <span className="w-14 text-right text-ink-2 tabular">{d.total ? formatDuration(d.total) : d.future ? "" : "—"}</span>
          </div>
        ))}
        <div className="mt-0.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-chart-1" />
            In office
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-chart-2" />
            Official movement
          </span>
        </div>
      </div>
    </Card>
  );
}
