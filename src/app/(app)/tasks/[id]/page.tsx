import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Clock, GraduationCap, History, MessageSquare, Pencil, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Project, Task, TimesheetEntry } from "@/lib/models";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { optionLabel } from "@/lib/status";
import { diffDays, fmtDate, fmtDateTime, formatDuration, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { allowedTaskStatuses, categoryOf, keysInCategories, peopleMap, projectCaps, taskCaps, taskFilter, TASK_CLOSED_CATEGORIES } from "@/lib/work-access";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip, OptionChip, StatusChip, Tag } from "@/components/ui/chip";
import { AttachmentList } from "@/components/ui/file-upload";
import { Alert, PageBody, Progress } from "@/components/ui/page";
import { LinkTabs } from "@/components/ui/tabs";
import { CommentList, HistoryTimeline } from "../_components/activity";
import { CommentBox } from "../_components/comment-box";
import { EffortBar, hoursLabel } from "../_components/effort";
import { TASK_ROW_FIELDS, toTaskRows } from "../_components/task-rows";
import { TaskStatusMenu } from "../_components/task-status-menu";
import { DueLabel } from "../_components/task-ui";
import { addTaskComment } from "../actions";
import { AttachFiles } from "./attach-files";
import { BlockerNote } from "./blocker-note";
import { ProgressSlider } from "./progress-slider";
import { ReviewActions } from "./review-actions";
import { SubmitWork } from "./submit-work";
import { SubtaskAdd } from "./subtask-add";

export const metadata = { title: "Task" };

function PersonRow({ name, photo, sub }: { name: string; photo?: string; sub?: string }) {
  return (
    <span className="flex items-center gap-2">
      <Avatar name={name} src={photo} size="xs" />
      <span className="min-w-0 break-words">{name}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[13px]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="flex min-w-0 flex-col items-end gap-1 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const sp = await searchParams;
  const user = await requireUser();
  await connectDB();
  const visible = await taskFilter(user);
  const task = await Task.findOne({ $and: [{ _id: id }, visible] }).lean();
  if (!task) notFound();

  const settings = await getSettings();
  const statuses = settings.taskStatuses;
  const closedKeys = keysInCategories(statuses, TASK_CLOSED_CATEGORIES);
  const project = task.project ? await Project.findById(task.project, { projectNo: 1, title: 1, manager: 1, team: 1, milestones: 1 }).lean() : null;
  const caps = taskCaps(user, task, project?.manager);
  const canOpenProject = project ? projectCaps(user, project).view : false;
  const category = categoryOf(statuses, task.status);
  const closed = closedKeys.includes(task.status);
  const today = todayKey();
  const tab = ["comments", "history", "time"].includes(param(sp, "tab")) ? param(sp, "tab") : "comments";
  const isShared = task.sharedWith.some((s) => s.toString() === user.id);

  const [people, allDeps, visibleDeps, dependents, subtaskDocs, parentTask, timeTotals, timeEntries] = await Promise.all([
    peopleMap([...task.assignees, task.reporter, task.reviewer, ...task.sharedWith]),
    task.dependencies.length ? Task.find({ _id: { $in: task.dependencies } }, { status: 1 }).lean() : [],
    task.dependencies.length ? Task.find({ $and: [{ _id: { $in: task.dependencies } }, visible] }, { taskNo: 1, title: 1, status: 1 }).lean() : [],
    Task.find({ $and: [{ dependencies: task._id }, visible] }, { taskNo: 1, title: 1, status: 1 }).limit(20).lean(),
    Task.find({ $and: [{ parent: task._id }, visible] }, TASK_ROW_FIELDS).sort({ createdAt: 1 }).lean(),
    task.parent ? Task.findOne({ $and: [{ _id: task.parent }, visible] }, { taskNo: 1, title: 1 }).lean() : null,
    TimesheetEntry.aggregate<{ _id: null; minutes: number }>([{ $match: { task: task._id, status: { $ne: "rejected" } } }, { $group: { _id: null, minutes: { $sum: "$minutes" } } }]),
    TimesheetEntry.find(caps.manage ? { task: task._id, status: { $ne: "rejected" } } : { task: task._id, user: user._id, status: { $ne: "rejected" } })
      .sort({ date: -1 })
      .limit(100)
      .lean(),
  ]);
  const subtasks = await toTaskRows(user, subtaskDocs, settings);
  const entryPeople = await peopleMap(timeEntries.map((e) => e.user));

  const loggedHours = (timeTotals[0]?.minutes ?? 0) / 60;
  const unmetDeps = allDeps.filter((d) => !closedKeys.includes(d.status)).length;
  const blocked = !closed && (category === "blocked" || unmetDeps > 0);
  const daysLate = !closed && task.dueDate && task.dueDate < today ? diffDays(task.dueDate, today) : 0;
  const milestone = project?.milestones.find((m) => m._id.toString() === task.milestone?.toString());
  const inReview = category === "review";
  const pendingSubmission = task.submissions.some((s) => s.reviewStatus === "pending");
  const current = statuses.find((s) => s.key === task.status);
  const allowed = allowedTaskStatuses(settings, caps, task);
  const toChoice = (s: (typeof statuses)[number]) => ({ key: s.key, label: s.label, tone: s.tone, category: s.category });
  const tabHref = (t: string) => `/tasks/${id}${t === "comments" ? "" : `?tab=${t}`}`;
  const canWorkOn = caps.isAssignee && !closed;
  const doneSubtasks = subtasks.filter((s) => closedKeys.includes(s.status)).length;

  return (
    <PageBody>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={project && canOpenProject ? `/projects/${project._id}?tab=tasks` : "/tasks"} className="mb-1 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-brand-600">
            ← {project && canOpenProject ? project.title : "Tasks"}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{task.taskNo}</span>
            <OptionChip options={statuses} value={task.status} />
            <StatusChip domain="priority" value={task.priority} />
            {daysLate > 0 && <Chip tone="red">{daysLate} {daysLate === 1 ? "day" : "days"} overdue</Chip>}
            {blocked && (
              <Chip tone="red">
                <Ban className="size-3" aria-hidden />
                Blocked
              </Chip>
            )}
            {task.isLearning && (
              <Tag tone="purple">
                <GraduationCap className="mr-1 size-3" aria-hidden />
                Learning task
              </Tag>
            )}
          </div>
          <h1 className="mt-1.5 font-display text-[22px] leading-tight font-semibold break-words text-ink sm:text-[26px]">{task.title}</h1>
          {parentTask && (
            <p className="mt-1 text-[13px] break-words text-muted">
              Subtask of{" "}
              <Link href={`/tasks/${parentTask._id}`} className="font-semibold text-brand-600 hover:text-brand-800">
                {parentTask.taskNo} · {parentTask.title}
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(caps.isAssignee || isShared) && (
            <ButtonLink href={`/timesheets?task=${id}`} variant="secondary" icon={<Clock className="size-4" aria-hidden />}>
              Log time
            </ButtonLink>
          )}
          {caps.manage && (
            <ButtonLink href={`/tasks/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />}>
              Edit
            </ButtonLink>
          )}
        </div>
      </div>

      {blocked && (
        <Alert tone="danger" title="This task is blocked.">
          {unmetDeps > 0 ? `${unmetDeps} ${unmetDeps === 1 ? "dependency is" : "dependencies are"} not done yet. ` : ""}
          <span className="break-words">{task.blocker}</span>
        </Alert>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardBody className="flex flex-col gap-5 pt-5">
              <section aria-label="Description">
                {task.description ? <p className="text-sm leading-relaxed break-words whitespace-pre-line text-ink-2">{task.description}</p> : <p className="text-sm text-muted">No description provided.</p>}
              </section>

              {!task.parent && (
                <section aria-label="Subtasks" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-sans text-sm font-semibold">
                      Subtasks {subtasks.length > 0 && <span className="font-normal text-muted">· {doneSubtasks} of {subtasks.length} done</span>}
                    </h2>
                    {caps.manage && (
                      <Link href={`/tasks/new?parent=${id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-800">
                        <Plus className="size-3.5" aria-hidden />
                        Full form
                      </Link>
                    )}
                  </div>
                  {subtasks.length === 0 && <p className="text-[13px] text-muted">No subtasks yet.</p>}
                  <ul className="flex flex-col gap-1.5">
                    {subtasks.map((s) => {
                      const cur = statuses.find((x) => x.key === s.status);
                      return (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line-soft px-3 py-2 text-sm">
                          <Link href={`/tasks/${s.id}`} className={`min-w-0 flex-1 break-words max-sm:basis-full hover:text-brand-600 ${closedKeys.includes(s.status) ? "text-muted line-through" : "text-ink"}`}>
                            <span className="mr-2 font-mono text-[11px] whitespace-nowrap text-muted no-underline">{s.taskNo}</span>
                            {s.title}
                          </Link>
                          <span className="text-xs text-muted">{s.assignees.map((a) => a.name.split(" ")[0]).join(", ")}</span>
                          <TaskStatusMenu
                            taskId={s.id}
                            size="sm"
                            current={cur ? toChoice(cur) : { key: s.status, label: s.status, tone: "gray" }}
                            choices={statuses.filter((x) => s.allowedStatuses.includes(x.key)).map(toChoice)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  {(caps.manage || caps.isAssignee) && <SubtaskAdd parentId={id} />}
                </section>
              )}

              {(visibleDeps.length > 0 || dependents.length > 0 || allDeps.length > visibleDeps.length) && (
                <section aria-label="Dependencies" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className={`flex flex-col gap-1.5 rounded-xl p-3.5 ${unmetDeps > 0 ? "bg-danger-bg" : "bg-ground"}`}>
                    <h2 className={`font-sans text-xs font-semibold ${unmetDeps > 0 ? "text-[#8e1c1c]" : "text-ink-2"}`}>Depends on</h2>
                    {visibleDeps.length === 0 && allDeps.length === 0 && <span className="text-[13px] text-muted">Nothing</span>}
                    {visibleDeps.map((d) => (
                      <Link key={d._id.toString()} href={`/tasks/${d._id}`} className="flex items-center justify-between gap-2 text-[13px] font-semibold text-ink hover:text-brand-600">
                        <span className="min-w-0 break-words">
                          {d.taskNo} · {d.title}
                        </span>
                        <OptionChip options={statuses} value={d.status} />
                      </Link>
                    ))}
                    {allDeps.length > visibleDeps.length && <span className="text-xs text-muted">{allDeps.length - visibleDeps.length} more not visible to you</span>}
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-xl bg-ground p-3.5">
                    <h2 className="font-sans text-xs font-semibold text-ink-2">Blocks</h2>
                    {dependents.length === 0 && <span className="text-[13px] text-muted">Nothing</span>}
                    {dependents.map((d) => (
                      <Link key={d._id.toString()} href={`/tasks/${d._id}`} className="min-w-0 break-words text-[13px] font-semibold text-ink hover:text-brand-600">
                        {d.taskNo} · {d.title}
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              <section aria-label="Attachments" className="flex flex-col gap-2">
                <h2 className="font-sans text-sm font-semibold">Attachments</h2>
                <AttachmentList files={task.attachments.map((a) => ({ file: a.file.toString(), name: a.name, size: a.size }))} />
                {caps.attach && <AttachFiles taskId={id} />}
              </section>
            </CardBody>
          </Card>

          {(task.submissions.length > 0 || canWorkOn) && (
            <Card>
              <CardHeader title="Work submissions" subtitle={inReview ? "Awaiting review" : undefined} />
              <CardBody className="flex flex-col gap-4">
                {task.submissions.length === 0 && <p className="text-[13px] text-muted">Nothing submitted yet. When you finish, use “Submit work for review”.</p>}
                {[...task.submissions].reverse().map((s, i) => (
                  <article key={s._id?.toString() ?? i} className="flex flex-col gap-2 rounded-xl border border-line-soft p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px]">
                        <strong>{s.submittedByName}</strong> <span className="text-muted">· {fmtDateTime(s.submittedAt)}</span>
                      </span>
                      <StatusChip domain="submission" value={s.reviewStatus} />
                    </div>
                    <p className="text-sm break-words whitespace-pre-line text-ink-2">{s.note}</p>
                    {s.link && (
                      <a href={s.link} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words text-[13px] font-semibold text-brand-600 hover:text-brand-800">
                        {s.link}
                      </a>
                    )}
                    {s.attachments.length > 0 && <AttachmentList files={s.attachments.map((a) => ({ file: a.file.toString(), name: a.name, size: a.size }))} />}
                    {s.reviewStatus !== "pending" && (
                      <div className="rounded-lg bg-field px-3 py-2 text-[13px] text-ink-2">
                        <strong>{s.reviewedByName}</strong> {s.reviewStatus === "approved" ? "approved" : "requested changes"}
                        {s.rating ? ` · ${s.rating}/5` : ""}
                        {s.reviewedAt ? <span className="text-muted"> · {fmtDateTime(s.reviewedAt)}</span> : null}
                        {s.reviewNote && <p className="mt-1 break-words whitespace-pre-line">{s.reviewNote}</p>}
                      </div>
                    )}
                  </article>
                ))}
                {inReview && caps.review && !caps.isAssignee && (
                  <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
                    <p className="text-[13px] text-muted">{pendingSubmission ? "Review the latest submission." : "This task is in review without a submission."}</p>
                    <ReviewActions taskId={id} />
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <div className="px-5 pt-1">
              <LinkTabs
                items={[
                  { href: tabHref("comments"), label: "Comments", icon: <MessageSquare className="size-[18px]" />, count: task.comments.length, active: tab === "comments" },
                  { href: tabHref("history"), label: "History", icon: <History className="size-[18px]" />, active: tab === "history" },
                  { href: tabHref("time"), label: "Time logs", icon: <Clock className="size-[18px]" />, count: loggedHours > 0 ? `${hoursLabel(loggedHours)} h` : undefined, active: tab === "time" },
                ]}
              />
            </div>
            <CardBody className="pt-5">
              {tab === "comments" && (
                <div className="flex flex-col gap-5">
                  <CommentList comments={task.comments} />
                  <CommentBox action={addTaskComment.bind(null, id)} entityType="task" entityId={id} />
                </div>
              )}
              {tab === "history" && <HistoryTimeline history={task.history} />}
              {tab === "time" && (
                <div className="flex flex-col gap-3">
                  {timeEntries.length === 0 && <p className="text-[13px] text-muted">No time logged on this task yet.</p>}
                  <ul className="flex flex-col divide-y divide-line-soft">
                    {timeEntries.map((e) => (
                      <li key={e._id.toString()} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                        <span className="min-w-0">
                          <span className="font-semibold">{entryPeople.get(e.user.toString())?.name ?? "Unknown"}</span>
                          <span className="text-muted"> · {fmtDate(e.date, "EEE d MMM")}</span>
                          <span className="block min-w-0 break-words text-ink-2">{e.description}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusChip domain="timesheet" value={e.status} size="sm" />
                          <span className="font-semibold tabular">{formatDuration(e.minutes)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!caps.manage && <p className="text-xs text-muted">You only see your own time entries here.</p>}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardBody className="flex flex-col gap-4 pt-5">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-muted">Status</span>
                <TaskStatusMenu
                  taskId={id}
                  current={current ? toChoice(current) : { key: task.status, label: optionLabel(statuses, task.status), tone: "gray" }}
                  choices={statuses.filter((s) => allowed.includes(s.key)).map(toChoice)}
                />
                {caps.isAssignee && caps.intern && !closed && <span className="text-xs text-muted">To finish, submit your work for review.</span>}
                {caps.isAssignee && !caps.intern && task.reviewer && !closed && <span className="text-xs text-muted">A reviewer approves this task before it is done.</span>}
              </div>
              <dl className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
                <Row label="Project">
                  {project ? (
                    canOpenProject ? (
                      <Link href={`/projects/${project._id}`} className="text-brand-600 hover:text-brand-800">
                        {project.projectNo} · {project.title}
                      </Link>
                    ) : (
                      <span>{project.title}</span>
                    )
                  ) : (
                    <span className="text-muted">No project</span>
                  )}
                </Row>
                {milestone && <Row label="Milestone">{milestone.title}</Row>}
                <Row label="Assignees">
                  {task.assignees.length === 0 && <span className="text-muted">Unassigned</span>}
                  {task.assignees.map((a) => {
                    const p = people.get(a.toString());
                    return <PersonRow key={a.toString()} name={p?.name ?? "Unknown"} photo={p?.photo} sub={p?.personType === "intern" || p?.personType === "trainee" ? "Intern" : undefined} />;
                  })}
                </Row>
                <Row label="Reviewer">
                  {task.reviewer ? <PersonRow name={people.get(task.reviewer.toString())?.name ?? "Unknown"} photo={people.get(task.reviewer.toString())?.photo} /> : <span className="text-muted">None</span>}
                </Row>
                <Row label="Reporter">
                  {task.reporter ? <PersonRow name={people.get(task.reporter.toString())?.name ?? "Unknown"} photo={people.get(task.reporter.toString())?.photo} /> : <span className="text-muted">—</span>}
                </Row>
                {task.sharedWith.length > 0 && (caps.manage || isShared) && (
                  <Row label="Shared with">
                    {task.sharedWith.map((s) => (
                      <PersonRow key={s.toString()} name={people.get(s.toString())?.name ?? "Unknown"} photo={people.get(s.toString())?.photo} />
                    ))}
                  </Row>
                )}
                <Row label="Start">{fmtDate(task.startDate)}</Row>
                <Row label="Due">
                  <span>
                    {fmtDate(task.dueDate, "EEE d MMM yyyy")} {daysLate > 0 && <DueLabel row={{ dueDate: task.dueDate, daysLate }} className="ml-1" />}
                  </span>
                </Row>
                <Row label="Created">{fmtDate(task.createdAt)}</Row>
                {task.completedAt && <Row label="Completed">{fmtDate(task.completedAt)}</Row>}
              </dl>

              <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">Logged vs estimate</span>
                  <span className={`font-semibold tabular ${task.estimateHours > 0 && loggedHours > task.estimateHours ? "text-danger" : "text-ink"}`}>
                    {hoursLabel(loggedHours)} / {task.estimateHours > 0 ? hoursLabel(task.estimateHours) : "—"} h
                  </span>
                </div>
                <EffortBar actualHours={loggedHours} estimateHours={task.estimateHours} />
              </div>

              <div className="border-t border-line-soft pt-4">
                {(caps.isAssignee || caps.manage) && !(closed && !caps.manage) ? (
                  <ProgressSlider key={task.progress} taskId={id} initial={task.progress} />
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Progress</span>
                      <span className="font-semibold tabular">{task.progress}%</span>
                    </div>
                    <Progress value={task.progress} />
                  </div>
                )}
              </div>

              {(caps.isAssignee || caps.manage) && !closed ? (
                <div className="border-t border-line-soft pt-4">
                  <BlockerNote key={task.blocker ?? ""} taskId={id} initial={task.blocker ?? ""} />
                </div>
              ) : (
                task.blocker && (
                  <div className="border-t border-line-soft pt-4 text-[13px]">
                    <span className="text-xs text-muted">Blocker note</span>
                    <p className="mt-1 break-words text-ink-2">{task.blocker}</p>
                  </div>
                )
              )}

              {canWorkOn && <SubmitWork taskId={id} pendingReview={pendingSubmission && inReview} />}
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
