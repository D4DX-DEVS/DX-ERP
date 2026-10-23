import Link from "next/link";
import { Bell, Megaphone, Pin } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { LeaveRequest, Movement, Notification, Project, TimesheetEntry } from "@/lib/models";
import { leaveBalances, leaveYearOf } from "@/lib/domain/leave-balance";
import { peopleMap } from "@/lib/reports/shared";
import { getSettings } from "@/lib/settings";
import { statusLabel } from "@/lib/status";
import { addDays, fmtDate, fmtTime, formatDuration, timeAgo, weekStart } from "@/lib/time";
import { formatHours } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip, OptionChip, StatusChip } from "@/components/ui/chip";
import { EmptyState, Progress } from "@/components/ui/page";
import { safeLink } from "@/app/(app)/notifications/meta";
import { loadAnnouncements } from "@/app/(app)/notifications/data";
import { classifyOpenMovement, getPeriods, loadOpenTasks } from "../_lib/queries";
import { DUE_TONE_CLASS, dueLabel, ListRow } from "./shared";

const PRIORITY_DOT: Record<string, string> = { urgent: "bg-danger", high: "bg-outside", medium: "bg-warning", low: "bg-subtle" };

/** The person's last five movements with duration and status. Their own personal movements show in full. */
export async function MyMovementsCard({ userId }: { userId: string }) {
  await connectDB();
  const settings = await getSettings();
  const { today } = getPeriods();
  const rows = await Movement.find(
    { user: userId, status: { $ne: "draft" } },
    { date: 1, outTime: 1, inTime: 1, expectedReturn: 1, durationMinutes: 1, categoryLabel: 1, official: 1, purpose: 1, status: 1, approvalStatus: 1 },
  )
    .sort({ date: -1, outTime: -1 })
    .limit(5)
    .lean();
  return (
    <Card className="h-full">
      <CardHeader title="My movements" href="/movement?tab=mine" hrefLabel="History" />
      {rows.length === 0 ? (
        <EmptyState title="No movements yet" description="Record an Out-Time whenever you leave the office during working hours." className="py-8" />
      ) : (
        <ul>
          {rows.map((m) => {
            const state = m.status === "out" ? classifyOpenMovement(m, settings, today) : undefined;
            const missing = state === "missing_in";
            const overdue = state === "overdue";
            return (
              <li key={m._id.toString()} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-5 py-3">
                <span className="w-16 shrink-0 text-[13px] font-semibold text-ink">{fmtDate(m.date, "EEE d MMM")}</span>
                <span className="min-w-40 flex-1">
                  <Link href={`/movement/${m._id}`} className="block truncate text-[13px] font-medium text-ink hover:text-brand-600">
                    {m.official ? "Official" : "Personal"} · {m.purpose}
                  </Link>
                  <span className="block text-xs text-muted">
                    Out {fmtTime(m.outTime)}
                    {m.inTime ? ` · In ${fmtTime(m.inTime)}` : ""}
                  </span>
                </span>
                <span className="w-14 shrink-0 text-[13px] text-ink-2 tabular">{m.durationMinutes !== undefined ? formatDuration(m.durationMinutes) : "—"}</span>
                <span className="flex shrink-0 flex-wrap gap-1.5">
                  {missing ? (
                    <Chip tone="purple">Missing In-Time</Chip>
                  ) : overdue ? (
                    <Chip tone="red">Overdue</Chip>
                  ) : (
                    <StatusChip domain="movement" value={m.status} />
                  )}
                  {(m.approvalStatus === "pending" || m.approvalStatus === "rejected" || m.approvalStatus === "correction_requested") && <StatusChip domain="movementApproval" value={m.approvalStatus} />}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Leave balances for the current leave year plus requests still waiting for a decision. */
export async function LeaveCard({ user }: { user: CurrentUser }) {
  await connectDB();
  const settings = await getSettings();
  const { today } = getPeriods();
  const [balances, pending] = await Promise.all([
    leaveBalances(user._id, user.personType, leaveYearOf(today, settings), settings, today),
    LeaveRequest.find({ user: user._id, status: { $in: ["pending_manager", "pending_hr"] } }, { startDate: 1, endDate: 1, days: 1, leaveTypeName: 1, status: 1, manager: 1 })
      .sort({ startDate: 1 })
      .limit(3)
      .lean(),
  ]);
  const managers = await peopleMap(pending.map((p) => p.manager));
  const shown = balances.filter((b) => !b.unlimited && (b.quota > 0 || b.available !== 0 || b.pending > 0)).slice(0, 4);
  return (
    <Card className="h-full">
      <CardHeader title="Leave balance" href="/leave" hrefLabel="Apply" />
      <CardBody className="flex flex-col gap-4">
        {shown.length === 0 ? (
          <p className="text-[13px] text-muted">No leave types apply to you yet.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2">
            {shown.map((b) => (
              <div key={b.leaveTypeId} className="rounded-xl bg-field px-3 py-2.5">
                <dt className="text-xs text-muted">{b.name}</dt>
                <dd className="font-display text-xl font-semibold text-ink tabular">
                  <span className={b.available < 0 ? "text-danger" : undefined}>{b.available}</span>
                  {b.quota > 0 && <span className="text-sm font-medium text-muted"> / {b.quota + b.carriedForward + b.adjustment}</span>}
                </dd>
                {b.pending > 0 && <div className="text-[11px] text-muted">{b.pending} pending</div>}
              </div>
            ))}
          </dl>
        )}
        {pending.length > 0 && (
          <div className="flex flex-col gap-2.5 border-t border-line-soft pt-3">
            <div className="text-xs font-semibold text-muted">Waiting for approval</div>
            {pending.map((r) => (
              <Link key={r._id.toString()} href={`/leave/${r._id}`} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">
                    {r.startDate === r.endDate ? fmtDate(r.startDate, "EEE d MMM") : `${fmtDate(r.startDate, "d MMM")} – ${fmtDate(r.endDate, "d MMM")}`} · {r.leaveTypeName}
                  </span>
                  <span className="block text-xs text-muted">
                    {r.days} day{r.days === 1 ? "" : "s"} · {r.status === "pending_hr" ? "Waiting for HR" : `Waiting for ${(r.manager && managers.get(r.manager.toString())?.name) || "your manager"}`}
                  </span>
                </span>
                <Chip tone="amber">Pending</Chip>
              </Link>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Open tasks soonest-first; overdue deadlines are highlighted. */
export async function MyTasksCard({ user }: { user: CurrentUser }) {
  const settings = await getSettings();
  const { today } = getPeriods();
  const closed = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);
  const { tasks, total } = await loadOpenTasks(user._id, closed, 6);
  const projectRows = await Project.find({ _id: { $in: tasks.flatMap((t) => (t.project ? [t.project] : [])) } }, { title: 1 }).lean();
  const projects = new Map(projectRows.map((p) => [p._id.toString(), p.title]));
  return (
    <Card className="h-full">
      <CardHeader title="My tasks" subtitle={`${total} open`} href="/tasks" hrefLabel="Task board" />
      {tasks.length === 0 ? (
        <EmptyState title="Nothing assigned to you" description="Tasks assigned to you will show up here with their deadlines." className="py-8" />
      ) : (
        <div>
          {tasks.map((t) => {
            const due = dueLabel(t.dueDate, today);
            return (
              <ListRow
                key={t.id}
                href={`/tasks/${t.id}`}
                icon={<span className={cn("size-2.5 shrink-0 rounded-full", PRIORITY_DOT[t.priority] ?? "bg-subtle")} title={`${statusLabel("priority", t.priority)} priority`} />}
                title={t.title}
                meta={`${t.taskNo}${t.project ? ` · ${projects.get(t.project.toString()) ?? ""}` : ""}`}
                trailing={
                  <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <OptionChip options={settings.taskStatuses} value={t.status} />
                    <span className={cn("w-24 text-right text-xs whitespace-nowrap", DUE_TONE_CLASS[due.tone])}>{due.text}</span>
                  </span>
                }
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

type SheetState = "none" | "draft" | "submitted" | "approved" | "rejected";

/** This week's timesheet: hours logged against 40 h, per-day bars and the submission state. */
export async function TimesheetWeekCard({ userId }: { userId: string }) {
  await connectDB();
  const { today } = getPeriods();
  const start = weekStart(today);
  const entries = await TimesheetEntry.find({ user: userId, weekStart: start }, { date: 1, minutes: 1, status: 1 }).lean();
  const days = Array.from({ length: 5 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, number>();
  for (const e of entries) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.minutes);
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const state: SheetState =
    entries.length === 0
      ? "none"
      : entries.some((e) => e.status === "rejected")
        ? "rejected"
        : entries.every((e) => e.status === "approved")
          ? "approved"
          : entries.some((e) => e.status === "submitted")
            ? "submitted"
            : "draft";
  const peak = Math.max(480, ...days.map((d) => byDay.get(d) ?? 0));
  return (
    <Card className="h-full">
      <CardHeader title={`Timesheet · week of ${fmtDate(start, "d MMM")}`} action={state === "none" ? <Chip tone="gray">Not started</Chip> : <StatusChip domain="timesheet" value={state} />} href="/timesheets" hrefLabel="Log time" />
      <CardBody className="flex flex-col gap-4">
        <div>
          <div className="font-display text-[28px] leading-none font-semibold text-ink tabular">
            {formatHours(total)} <span className="text-sm font-medium text-muted">logged of 40 h</span>
          </div>
          <Progress value={(total / 2400) * 100} className="mt-3" />
        </div>
        <ul className="grid grid-cols-5 gap-2" aria-label="Hours logged per day">
          {days.map((d) => {
            const minutes = byDay.get(d) ?? 0;
            return (
              <li key={d} className="flex flex-col items-center gap-1.5">
                <span className="flex h-14 w-full items-end rounded-md bg-field">
                  <span className={cn("w-full rounded-md", d === today ? "bg-chart-1" : "bg-brand-200")} style={{ height: `${Math.max(minutes ? 8 : 0, (minutes / peak) * 100)}%` }} />
                </span>
                <span className="text-[11px] font-medium text-muted">{fmtDate(d, "EEE")}</span>
                <span className="text-xs font-semibold text-ink tabular">{minutes ? formatHours(minutes).replace(" h", "") : "–"}</span>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Announcements for this person: pinned first, expired ones hidden. */
export async function AnnouncementsCard({ user }: { user: CurrentUser }) {
  const { today } = getPeriods();
  const items = await loadAnnouncements(user, today, { limit: 4 });
  return (
    <Card className="h-full">
      <CardHeader title="Announcements" href="/notifications" hrefLabel="Inbox" />
      {items.length === 0 ? (
        <EmptyState icon={<Megaphone className="size-5" />} title="No announcements" description="Company notices will appear here." className="py-8" />
      ) : (
        <ul>
          {items.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 border-t border-line-soft px-5 py-3">
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                {a.pinned && <Pin className="size-3.5 shrink-0 text-brand-600" aria-label="Pinned" />}
                {a.title}
              </span>
              <span className="line-clamp-2 text-[13px] text-ink-2">{a.body}</span>
              <span className="text-xs text-muted">
                {a.publishedByName} · {timeAgo(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export async function LatestNotificationsCard({ userId }: { userId: string }) {
  await connectDB();
  const [items, unread] = await Promise.all([
    Notification.find({ user: userId }, { title: 1, link: 1, read: 1, createdAt: 1, type: 1 }).sort({ createdAt: -1 }).limit(5).lean(),
    Notification.countDocuments({ user: userId, read: false }),
  ]);
  return (
    <Card className="h-full">
      <CardHeader title="Latest notifications" subtitle={unread > 0 ? `${unread} unread` : undefined} href="/notifications" hrefLabel="Inbox" />
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-5" />} title="You're all caught up" description="New alerts about your work will appear here." className="py-8" />
      ) : (
        <div>
          {items.map((n) => (
            <ListRow
              key={n._id.toString()}
              href={safeLink(n.link) ?? "/notifications"}
              icon={<span className={cn("size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-600")} role="img" aria-label={n.read ? "Read" : "Unread"} />}
              title={n.title}
              meta={timeAgo(n.createdAt)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
