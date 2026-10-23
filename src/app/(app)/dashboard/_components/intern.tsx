import { cache } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, CircleDot, Mail, Phone, XCircle } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { LearningResource, Project, Review, User } from "@/lib/models";
import { loadAttendance, peopleMap } from "@/lib/reports/shared";
import { getSettings } from "@/lib/settings";
import { diffDays, eachDay, fmtDate, formatDuration } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip, StatusChip, Tag } from "@/components/ui/chip";
import { EmptyState, Progress } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { getPeriods, loadOpenTasks } from "../_lib/queries";
import { DUE_TONE_CLASS, dueLabel, ListRow } from "./shared";

const loadProfile = cache(async (userId: string) => {
  await connectDB();
  return User.findById(userId, { internship: 1, reportingManager: 1, department: 1, joiningDate: 1 }).lean();
});

const OBJECTIVE_ICON = {
  achieved: <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Achieved" />,
  in_progress: <CircleDot className="size-4 shrink-0 text-brand-600" aria-label="In progress" />,
  open: <Circle className="size-4 shrink-0 text-subtle" aria-label="Open" />,
  dropped: <XCircle className="size-4 shrink-0 text-subtle" aria-label="Dropped" />,
} as const;

/** Internship dates, progress and objectives (FRS §4.3, §6.1). */
export async function InternshipCard({ userId }: { userId: string }) {
  const profile = await loadProfile(userId);
  const { today } = getPeriods();
  const i = profile?.internship;
  const start = i?.startDate ?? profile?.joiningDate;
  const end = i?.endDate;

  if (!start || !end) {
    return (
      <Card className="h-full">
        <CardHeader title="Internship progress" />
        <EmptyState title="Dates not set yet" description="HR will add your start and expected completion dates. Until then, your attendance and tasks still work as usual." className="py-8" />
      </Card>
    );
  }
  const totalDays = Math.max(1, diffDays(start, end) + 1);
  const elapsed = Math.min(totalDays, Math.max(0, diffDays(start, today) + 1));
  const remaining = Math.max(0, diffDays(today, end));
  const weeks = Math.ceil(totalDays / 7);
  const week = Math.min(weeks, Math.max(1, Math.ceil(elapsed / 7)));
  const objectives = (i?.objectives ?? []).filter((o) => o.status !== "dropped");
  const met = objectives.filter((o) => o.status === "achieved").length;
  const finished = today > end;

  return (
    <Card className="h-full">
      <CardHeader title="Internship progress" action={i ? <StatusChip domain="internship" value={i.status} /> : undefined} />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <div className="text-xs text-muted">Started</div>
            <div className="font-semibold text-ink">{fmtDate(start)}</div>
          </div>
          <div>
            <div className="text-xs text-muted">Expected completion</div>
            <div className="font-semibold text-ink">{fmtDate(end)}</div>
          </div>
        </div>
        <div>
          <Progress value={(elapsed / totalDays) * 100} />
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
            <span>{today < start ? `Starts ${fmtDate(start)}` : finished ? "Internship period has ended" : `Week ${week} of ${weeks}`}</span>
            <span className="font-semibold text-ink-2">{finished ? "Completed" : today < start ? `${diffDays(today, start)} days to start` : `${remaining} day${remaining === 1 ? "" : "s"} to go`}</span>
          </div>
        </div>
        <div className="border-t border-line-soft pt-3">
          <div className="mb-2 text-xs font-semibold text-muted">{objectives.length ? `Objectives · ${met} of ${objectives.length} met` : "Objectives"}</div>
          {objectives.length === 0 ? (
            <p className="text-[13px] text-muted">Your mentor will set learning objectives with you.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {objectives.map((o) => (
                <li key={o._id?.toString() ?? o.text} className="flex items-start gap-2 text-[13px] text-ink-2">
                  <span className="mt-0.5">{OBJECTIVE_ICON[o.status]}</span>
                  <span className={cn(o.status === "achieved" && "text-muted line-through decoration-line-strong")}>{o.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** Mentor (or supervisor) details with a way to reach them. */
export async function MentorCard({ userId }: { userId: string }) {
  const profile = await loadProfile(userId);
  const mentorId = profile?.internship?.mentor ?? profile?.reportingManager;
  const mentor = mentorId ? await User.findById(mentorId, { name: 1, email: 1, phone: 1, photo: 1 }).lean() : null;
  const info = mentorId ? (await peopleMap([mentorId])).get(mentorId.toString()) : undefined;
  return (
    <Card className="h-full">
      <CardHeader title={profile?.internship?.mentor ? "Your mentor" : "Your supervisor"} />
      <CardBody>
        {!mentor ? (
          <p className="text-[13px] text-muted">No mentor or supervisor has been assigned yet. HR will assign one.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar name={mentor.name} src={mentor.photo} size="lg" />
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-ink">{mentor.name}</div>
                <div className="truncate text-[13px] text-muted">{[info?.designation, info?.department].filter(Boolean).join(" · ") || "Mentor"}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`mailto:${mentor.email}`} className={buttonClass("secondary", "sm")}>
                <Mail className="size-4" aria-hidden />
                Message mentor
              </a>
              {mentor.phone && (
                <a href={`tel:${mentor.phone}`} className={buttonClass("secondary", "sm")}>
                  <Phone className="size-4" aria-hidden />
                  Call
                </a>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const DOT = {
  present: "bg-success",
  late: "bg-warning",
  leave: "bg-brand-400",
  absent: "bg-danger",
  today: "bg-line-strong",
} as const;

/** Month-to-date attendance and working hours with a dot per working day. */
export async function InternAttendanceCard({ userId }: { userId: string }) {
  const { today, monthFrom, month } = getPeriods();
  const ctx = await loadAttendance([userId], monthFrom, today);
  let present = 0;
  let late = 0;
  let worked = 0;
  let due = 0;
  const dots: { day: string; kind: keyof typeof DOT; label: string }[] = [];
  for (const day of eachDay(monthFrom, today)) {
    const doc = ctx.attendanceOf(userId, day);
    const leave = ctx.leaveOn(userId, day);
    if (doc?.checkIn) {
      present += 1;
      if (doc.late) late += 1;
      if (doc.checkOut) worked += doc.workMinutes;
    }
    if (!ctx.cal.isWorkingDay(day) && !doc?.checkIn) continue;
    if (leave === "full" && !doc?.checkIn) {
      dots.push({ day, kind: "leave", label: "On leave" });
      continue;
    }
    due += 1;
    if (doc?.checkIn) dots.push({ day, kind: doc.late ? "late" : "present", label: doc.late ? "Late" : "Present" });
    else if (day === today) dots.push({ day, kind: "today", label: "Not checked in yet" });
    else dots.push({ day, kind: "absent", label: "Absent" });
  }
  const completedDays = ctx.cal.workingDaysBetween(monthFrom, today).filter((d) => ctx.attendanceOf(userId, d)?.checkOut).length;
  return (
    <Card className="h-full">
      <CardHeader title={`Attendance · ${fmtDate(`${month}-01`, "MMMM")}`} href="/attendance" hrefLabel="Details" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-field px-2 py-2.5">
            <div className="font-display text-xl font-semibold text-ink tabular">
              {present}
              <span className="text-sm font-medium text-muted"> / {due}</span>
            </div>
            <div className="text-xs text-muted">Days present</div>
          </div>
          <div className="rounded-xl bg-field px-2 py-2.5">
            <div className="font-display text-xl font-semibold text-ink tabular">{completedDays ? formatDuration(worked / completedDays) : "—"}</div>
            <div className="text-xs text-muted">Average day</div>
          </div>
          <div className="rounded-xl bg-field px-2 py-2.5">
            <div className="font-display text-xl font-semibold text-ink tabular">{late}</div>
            <div className="text-xs text-muted">Late arrivals</div>
          </div>
        </div>
        {dots.length > 0 && (
          <div>
            <ul className="flex flex-wrap gap-1.5" aria-label="Attendance by working day">
              {dots.map((d) => (
                <li key={d.day} title={`${fmtDate(d.day, "EEE d MMM")} · ${d.label}`} className={cn("size-3.5 rounded-[4px]", DOT[d.kind])}>
                  <span className="sr-only">
                    {fmtDate(d.day, "EEE d MMM")}: {d.label}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
              {([["present", "Present"], ["late", "Late"], ["leave", "Leave"], ["absent", "Absent"]] as const).map(([k, label]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-[3px]", DOT[k])} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Assigned / shared tasks with the status of the latest submission and the next action. */
export async function InternTasksCard({ user }: { user: CurrentUser }) {
  const settings = await getSettings();
  const { today } = getPeriods();
  const closed = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);
  const [{ tasks, total }, memberProjects] = await Promise.all([
    loadOpenTasks(user._id, closed, 6, true),
    Project.find({ "team.user": user._id }, { projectNo: 1, title: 1 }).sort({ updatedAt: -1 }).limit(6).lean(),
  ]);
  const projectRows = await Project.find({ _id: { $in: tasks.flatMap((t) => (t.project ? [t.project] : [])) } }, { title: 1 }).lean();
  const titles = new Map(projectRows.map((p) => [p._id.toString(), p.title]));
  return (
    <Card className="h-full">
      <CardHeader title="Tasks & submissions" subtitle={`${total} open`} href="/tasks" hrefLabel="All tasks" />
      <TableWrap phone={[1, 2, 4]} tablet={[1, 2, 3, 4]}>
        <THead>
          <Th>Task</Th>
          <Th>Due</Th>
          <Th>Submission</Th>
          <Th align="right">Action</Th>
        </THead>
        <tbody>
          {tasks.length === 0 ? (
            <EmptyRow colSpan={4}>No open tasks. Your mentor will assign work here.</EmptyRow>
          ) : (
            tasks.map((t) => {
              const mine = t.submissions.filter((s) => s.submittedBy.toString() === user.id).sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())[0];
              const due = dueLabel(t.dueDate, today);
              const action = !mine ? "Submit" : mine.reviewStatus === "changes_requested" ? "Resubmit" : "View";
              return (
                <Tr key={t.id}>
                  <Td className="max-w-72">
                    <Link href={`/tasks/${t.id}`} className="block truncate font-semibold text-ink hover:text-brand-600">
                      {t.title}
                    </Link>
                    <span className="block truncate text-xs text-muted">{t.project ? (titles.get(t.project.toString()) ?? t.taskNo) : t.taskNo}</span>
                  </Td>
                  <Td className={cn("whitespace-nowrap", DUE_TONE_CLASS[due.tone])}>{due.text}</Td>
                  <Td>{mine ? <StatusChip domain="submission" value={mine.reviewStatus} /> : <Chip tone="gray">Not submitted</Chip>}</Td>
                  <Td align="right">
                    <Link href={`/tasks/${t.id}`} className={buttonClass(action === "View" ? "ghost" : "secondary", "sm")}>
                      {action}
                    </Link>
                  </Td>
                </Tr>
              );
            })
          )}
        </tbody>
      </TableWrap>
      {memberProjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-5 py-3 text-xs text-muted">
          <span>Projects you are on:</span>
          {memberProjects.map((p) => (
            <Tag key={p._id.toString()} tone="blue">
              {p.title}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Approved training material for this person's audience, or assigned to them, with completion. */
export async function LearningCard({ user }: { user: CurrentUser }) {
  await connectDB();
  const profile = await loadProfile(user.id);
  const dept = profile?.department;
  const rows = await LearningResource.find(
    {
      active: true,
      $and: [
        { $or: [{ assignedTo: user._id }, { assignedTo: { $size: 0 }, audience: user.personType }] },
        { $or: [{ department: { $exists: false } }, { department: null }, ...(dept ? [{ department: dept }] : [])] },
      ],
    },
    { title: 1, kind: 1, dueDate: 1, estimatedHours: 1, completions: 1 },
  )
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();
  const items = rows
    .map((r) => ({
      id: r._id.toString(),
      title: r.title,
      kind: r.kind,
      dueDate: r.dueDate,
      hours: r.estimatedHours,
      done: r.completions.some((c) => c.user?.toString() === user.id),
    }))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 4);
  const done = rows.filter((r) => r.completions.some((c) => c.user?.toString() === user.id)).length;
  return (
    <Card className="h-full">
      <CardHeader title="Learning" subtitle={rows.length ? `${done} of ${rows.length} completed` : undefined} href="/learning" hrefLabel="Library" />
      {items.length === 0 ? (
        <EmptyState title="No learning material yet" description="Approved training material and activities will appear here." className="py-8" />
      ) : (
        <div>
          {items.map((l) => (
            <ListRow
              key={l.id}
              href="/learning"
              icon={l.done ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Completed" /> : <Circle className="size-4 shrink-0 text-subtle" aria-label="Not completed" />}
              title={l.title}
              meta={[l.kind, l.hours ? `${l.hours} h` : "", l.dueDate ? `due ${fmtDate(l.dueDate)}` : ""].filter(Boolean).join(" · ")}
              trailing={l.done ? <Chip tone="green">Done</Chip> : undefined}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Latest evaluation shared with this person and whether they have acknowledged it. */
export async function FeedbackCard({ userId }: { userId: string }) {
  await connectDB();
  const review = await Review.findOne({ user: userId, status: "shared" }).sort({ date: -1 }).lean();
  return (
    <Card className="h-full">
      <CardHeader title="Latest feedback" subtitle={review ? `From ${review.reviewerName} · ${fmtDate(review.date)}` : undefined} href="/learning" hrefLabel="Reviews" />
      <CardBody className="flex flex-col gap-3">
        {!review ? (
          <p className="text-[13px] text-muted">No evaluation has been shared with you yet. Reviews from your mentor will show up here.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="purple">{review.periodLabel}</Chip>
              <Chip tone={review.acknowledgedAt ? "green" : "amber"}>{review.acknowledgedAt ? "Acknowledged" : "Awaiting your acknowledgement"}</Chip>
              {review.overall ? <span className="text-[13px] font-semibold text-ink tabular">{review.overall}/5 overall</span> : null}
            </div>
            {review.strengths && <p className="line-clamp-4 text-[13px] leading-relaxed text-ink-2">{review.strengths}</p>}
            {review.ratings.length > 0 && (
              <dl className="grid grid-cols-3 gap-2">
                {review.ratings.slice(0, 3).map((r) => (
                  <div key={r.key} className="rounded-xl bg-field px-2.5 py-2">
                    <dt className="truncate text-xs text-muted">{r.label}</dt>
                    <dd className="font-display text-base font-semibold text-ink tabular">{r.score}/5</dd>
                  </div>
                ))}
              </dl>
            )}
            {review.actionItems.some((a) => a.status === "open") && (
              <p className="text-xs text-muted">{review.actionItems.filter((a) => a.status === "open").length} improvement action(s) still open.</p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

