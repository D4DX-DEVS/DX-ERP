import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import { and, asc, desc, eq, gte, lt, ne, or, sql } from "drizzle-orm";
import { isStaff, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Project, Task, TimesheetEntry } from "@/lib/models";
import { dateParam, idParam, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { inList, jsonHas, notInList } from "@/lib/sql";
import { addDays, eachDay, fmtDate, fmtDateTime, formatDuration, todayKey, weekStart } from "@/lib/time";
import { keysInCategories, loggableProjectIds, taskFilter, timesheetScope } from "@/lib/work-access";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip, Tag } from "@/components/ui/chip";
import { EmptyState, MiniStat, PageBody, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { EffortBar, hoursLabel } from "../tasks/_components/effort";
import { AddEntry, EntryActions, type EntryInitial, type ProjectOption, type TaskOption } from "./entry-dialog";
import { durationInput } from "./duration";
import { SubmitWeek } from "./submit-week";
import { weekLabel, weekRange } from "./week";

export const metadata = { title: "Timesheet" };

/** Overall state of a week from its entries: anything rejected needs attention first. */
function weekState(statuses: string[]): string | undefined {
  for (const s of ["rejected", "draft", "submitted", "approved"]) if (statuses.includes(s)) return s;
  return undefined;
}

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;

  if (!isStaff(user)) {
    const scope = await timesheetScope(user);
    return (
      <PageBody>
        <PageHeader overline="My work" title="Timesheet" />
        <Card>
          <EmptyState
            icon={<ClipboardCheck className="size-5" />}
            title="Timesheets are recorded by staff"
            description="This account doesn't record time. You can still review submitted timesheets."
            action={scope.hasAccess ? <ButtonLink href="/timesheets/approvals">Open approvals</ButtonLink> : undefined}
          />
        </Card>
      </PageBody>
    );
  }

  const today = todayKey();
  const currentWeek = weekStart(today);
  const requested = dateParam(sp, "week");
  const week = requested ? weekStart(requested) : currentWeek;
  const days = eachDay(week, addDays(week, 6));
  const maxDate = addDays(week, 6) < today ? addDays(week, 6) : today;

  const settings = await getSettings();
  const cancelledTaskKeys = keysInCategories(settings.taskStatuses, ["cancelled"]);
  const visibleTasks = await taskFilter(user);
  const prefillTaskId = idParam(sp, "task");

  const [entries, loggable, previous, reviewScope] = await Promise.all([
    db()
      .select({
        _id: TimesheetEntry._id,
        date: TimesheetEntry.date,
        project: TimesheetEntry.project,
        task: TimesheetEntry.task,
        minutes: TimesheetEntry.minutes,
        description: TimesheetEntry.description,
        billable: TimesheetEntry.billable,
        status: TimesheetEntry.status,
        reviewNote: TimesheetEntry.reviewNote,
        reviewerName: TimesheetEntry.reviewerName,
        reviewedAt: TimesheetEntry.reviewedAt,
        history: TimesheetEntry.history,
      })
      .from(TimesheetEntry)
      .where(and(eq(TimesheetEntry.user, user._id), eq(TimesheetEntry.weekStart, week)))
      .orderBy(asc(TimesheetEntry.date), asc(TimesheetEntry.createdAt)),
    loggableProjectIds(user),
    db()
      .select({ week: TimesheetEntry.weekStart, status: TimesheetEntry.status, minutes: sql<number>`coalesce(sum(${TimesheetEntry.minutes}), 0)`.mapWith(Number) })
      .from(TimesheetEntry)
      .where(and(eq(TimesheetEntry.user, user._id), lt(TimesheetEntry.weekStart, currentWeek), gte(TimesheetEntry.weekStart, addDays(currentWeek, -7 * 6))))
      .groupBy(TimesheetEntry.weekStart, TimesheetEntry.status),
    timesheetScope(user, "view"),
  ]);

  const taskCols = { _id: Task._id, taskNo: Task.taskNo, title: Task.title, project: Task.project, estimateHours: Task.estimateHours };
  const [projectDocs, taskDocs] = await Promise.all([
    db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, status: Project.status })
      .from(Project)
      .where(inList(Project._id, loggable))
      .orderBy(desc(Project.projectNo)),
    db()
      .select(taskCols)
      .from(Task)
      .where(
        and(
          visibleTasks,
          notInList(Task.status, cancelledTaskKeys),
          or(inList(Task.project, loggable), jsonHas(Task.assignees, user._id), jsonHas(Task.sharedWith, user._id), prefillTaskId ? eq(Task._id, prefillTaskId) : undefined),
        ),
      )
      .orderBy(desc(Task.updatedAt))
      .limit(500),
  ]);

  const projectLabel = new Map(projectDocs.map((p) => [p._id, `${p.projectNo} · ${p.title}`]));
  const taskInfo = new Map(taskDocs.map((t) => [t._id, t]));
  // Entries may reference projects / tasks the user can no longer pick (e.g. removed from the team): resolve their labels too.
  const missingProjects = entries.map((e) => e.project).filter((id): id is string => Boolean(id) && !projectLabel.has(id!));
  const missingTasks = entries.map((e) => e.task).filter((id): id is string => Boolean(id) && !taskInfo.has(id!));
  const [extraProjects, extraTasks] = await Promise.all([
    missingProjects.length ? db().select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title }).from(Project).where(inList(Project._id, missingProjects)) : [],
    missingTasks.length ? db().select(taskCols).from(Task).where(inList(Task._id, missingTasks)) : [],
  ]);
  for (const p of extraProjects) projectLabel.set(p._id, `${p.projectNo} · ${p.title}`);
  for (const t of extraTasks) taskInfo.set(t._id, t);

  const projectOptions: ProjectOption[] = projectDocs
    .filter((p) => !["cancelled"].includes(settings.projectStatuses.find((s) => s.key === p.status)?.category ?? ""))
    .map((p) => ({ id: p._id, label: projectLabel.get(p._id)! }));
  const taskOptions: TaskOption[] = taskDocs.map((t) => ({ id: t._id, label: `${t.taskNo} · ${t.title}`, project: t.project ?? "" }));
  // Keep the week's own project / task selectable when editing an entry (e.g. a since-cancelled project or an older task),
  // so re-saving it never silently clears them.
  const listedProjects = new Set(projectOptions.map((p) => p.id));
  for (const id of new Set(entries.map((e) => e.project).filter((x): x is string => Boolean(x)))) {
    const label = projectLabel.get(id);
    if (!listedProjects.has(id) && label) projectOptions.push({ id, label });
  }
  for (const t of extraTasks) taskOptions.push({ id: t._id, label: `${t.taskNo} · ${t.title}`, project: t.project ?? "" });

  // Time logged against the week's tasks, over all weeks, for the estimated-vs-actual card.
  const weekTaskIds = [...new Set(entries.map((e) => e.task).filter((t): t is string => Boolean(t)))];
  const taskTotals = weekTaskIds.length
    ? await db()
        .select({ task: TimesheetEntry.task, minutes: sql<number>`coalesce(sum(${TimesheetEntry.minutes}), 0)`.mapWith(Number) })
        .from(TimesheetEntry)
        .where(and(inList(TimesheetEntry.task, weekTaskIds), ne(TimesheetEntry.status, "rejected")))
        .groupBy(TimesheetEntry.task)
    : [];

  const prefillTask = prefillTaskId ? taskInfo.get(prefillTaskId) : undefined;
  const defaultDate = week === currentWeek ? today : maxDate;
  const blank: EntryInitial = {
    date: defaultDate,
    project: prefillTask?.project ?? "",
    task: prefillTask?._id ?? "",
    duration: "",
    description: "",
    billable: Boolean(prefillTask?.project),
  };

  const byDay = new Map<string, typeof entries>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  const editable = entries.filter((e) => e.status === "draft" || e.status === "rejected");
  const state = weekState(entries.map((e) => e.status));

  const prevWeeks = new Map<string, { minutes: number; statuses: string[] }>();
  for (const r of previous) {
    const cur = prevWeeks.get(r.week) ?? { minutes: 0, statuses: [] };
    cur.minutes += r.minutes;
    cur.statuses.push(r.status);
    prevWeeks.set(r.week, cur);
  }
  const prevList = [...prevWeeks.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const formProps = { projects: projectOptions, tasks: taskOptions, minDate: week, maxDate };
  const entryInitial = (e: (typeof entries)[number]): EntryInitial => ({
    id: e._id,
    date: e.date,
    project: e.project ?? "",
    task: e.task ?? "",
    duration: durationInput(e.minutes),
    description: e.description,
    billable: e.billable,
  });

  return (
    <PageBody>
      <PageHeader
        overline="My work"
        title="Timesheet"
        actions={
          <>
            <div className="flex h-10 items-center rounded-[10px] border border-line-strong bg-white">
              <Link href={`/timesheets?week=${addDays(week, -7)}`} aria-label="Previous week" className="flex size-9 items-center justify-center text-ink-2 hover:text-brand-600">
                <ChevronLeft className="size-4" />
              </Link>
              <span className="px-1 text-sm font-semibold whitespace-nowrap">{weekLabel(week)}</span>
              {week < currentWeek ? (
                <Link href={`/timesheets?week=${addDays(week, 7)}`} aria-label="Next week" className="flex size-9 items-center justify-center text-ink-2 hover:text-brand-600">
                  <ChevronRight className="size-4" />
                </Link>
              ) : (
                <span className="flex size-9 items-center justify-center text-subtle" aria-hidden>
                  <ChevronRight className="size-4" />
                </span>
              )}
            </div>
            {state && <StatusChip domain="timesheet" value={state} />}
            {reviewScope.hasAccess && (
              <ButtonLink href="/timesheets/approvals" variant="secondary" icon={<ClipboardCheck className="size-4" aria-hidden />}>
                Approvals
              </ButtonLink>
            )}
            <AddEntry initial={blank} defaultOpen={Boolean(prefillTask)} {...formProps} />
            {editable.length > 0 && <SubmitWeek week={week} count={editable.length} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat value={formatDuration(total)} label="Logged this week" />
        <MiniStat value={formatDuration(billable)} label="Billable" />
        <MiniStat value={entries.filter((e) => e.status === "draft" || e.status === "rejected").length} label="To submit" />
        <MiniStat value={entries.filter((e) => e.status === "approved").length} label="Approved entries" />
      </div>

      {week !== currentWeek && <p className="text-[13px] text-muted">Showing {weekRange(week)}. <Link href="/timesheets" className="font-semibold text-brand-600 hover:text-brand-800">Back to this week</Link></p>}

      <div className="flex flex-col gap-3">
        {days.map((day, i) => {
          const list = byDay.get(day) ?? [];
          const dayTotal = list.reduce((s, e) => s + e.minutes, 0);
          const weekend = i >= 5;
          if (weekend && list.length === 0) return null;
          return (
            <Card key={day}>
              <div className="flex items-center justify-between gap-3 px-5 py-3">
                <h2 className="flex items-center gap-2 font-sans text-sm font-semibold">
                  {fmtDate(day, "EEEE d MMM")}
                  {day === today && <Tag tone="blue">Today</Tag>}
                </h2>
                <span className={cn("text-sm font-semibold tabular", dayTotal === 0 && "text-subtle")}>{dayTotal > 0 ? formatDuration(dayTotal) : "—"}</span>
              </div>
              {list.length === 0 ? (
                <p className="border-t border-line-soft px-5 py-3 text-[13px] text-muted">{day > today ? "Upcoming day" : "No time logged."}</p>
              ) : (
                <ul className="divide-y divide-line-soft border-t border-line-soft">
                  {list.map((e) => {
                    const task = e.task ? taskInfo.get(e.task) : undefined;
                    const locked = e.status === "submitted" || e.status === "approved";
                    return (
                      <li key={e._id} className="flex flex-col gap-2 px-5 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-semibold">
                              {task ? `${task.taskNo} · ${task.title}` : e.project ? "General work" : "Internal"}
                            </div>
                            <div className="truncate text-xs text-muted">{e.project ? projectLabel.get(e.project) : "No project"}</div>
                            <p className="mt-1 text-sm text-ink-2">{e.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Tag tone={e.billable ? "green" : "gray"}>{e.billable ? "Billable" : "Non-billable"}</Tag>
                            <StatusChip domain="timesheet" value={e.status} size="sm" />
                            <span className="w-16 text-right text-sm font-semibold tabular">{formatDuration(e.minutes)}</span>
                            {!locked && <EntryActions entryId={e._id} initial={entryInitial(e)} {...formProps} />}
                          </div>
                        </div>
                        {e.status === "rejected" && e.reviewNote && (
                          <p className="rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-[#8a1b1b]">
                            <strong>{e.reviewerName ?? "Reviewer"}</strong> asked for changes: {e.reviewNote}
                          </p>
                        )}
                        {e.status === "approved" && <p className="text-xs text-muted">Approved by {e.reviewerName ?? "a reviewer"}{e.reviewedAt ? ` · ${fmtDateTime(e.reviewedAt)}` : ""}. Locked — a reviewer can reopen it for correction.</p>}
                        {e.history.length > 1 && (
                          <details className="text-xs text-muted">
                            <summary className="cursor-pointer font-medium select-none">Correction history ({e.history.length})</summary>
                            <ul className="mt-1.5 flex flex-col gap-1 pl-3">
                              {e.history.map((h, hi) => (
                                <li key={hi}>
                                  {fmtDateTime(h.at)} · {h.byName ?? "System"} · {h.action}
                                  {h.note ? ` — ${h.note}` : ""}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Estimated vs actual" subtitle="Total hours logged on this week's tasks, against the estimate" />
          <CardBody className="flex flex-col gap-4">
            {taskTotals.length === 0 && <p className="text-[13px] text-muted">Log time against tasks to compare with their estimates.</p>}
            {taskTotals.map((r) => {
              const t = r.task ? taskInfo.get(r.task) : undefined;
              if (!t) return null;
              const actual = r.minutes / 60;
              return (
                <div key={r.task} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    <Link href={`/tasks/${t._id}`} className="min-w-0 truncate font-semibold hover:text-brand-600">
                      {t.taskNo} · {t.title}
                    </Link>
                    <span className={cn("shrink-0 font-semibold tabular", t.estimateHours > 0 && actual > t.estimateHours ? "text-danger" : "text-ink-2")}>
                      {hoursLabel(Math.round(actual * 10) / 10)} h of {t.estimateHours > 0 ? `${hoursLabel(t.estimateHours)} h` : "no estimate"}
                    </span>
                  </div>
                  <EffortBar actualHours={actual} estimateHours={t.estimateHours} className="h-2.5" />
                </div>
              );
            })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Previous weeks" />
          <CardBody className="pt-0">
            {prevList.length === 0 && <p className="text-[13px] text-muted">No earlier weeks yet.</p>}
            <ul className="flex flex-col divide-y divide-line-soft">
              {prevList.map(([w, info]) => {
                const st = weekState(info.statuses);
                return (
                  <li key={w}>
                    <Link href={`/timesheets?week=${w}`} className="flex items-center justify-between gap-3 py-2.5 text-[13px] hover:text-brand-600">
                      <span>
                        <strong>{weekLabel(w).split(" · ")[0]}</strong> · {weekRange(w)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular">{formatDuration(info.minutes)}</span>
                        {st && <StatusChip domain="timesheet" value={st} size="sm" />}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      </div>
    </PageBody>
  );
}
