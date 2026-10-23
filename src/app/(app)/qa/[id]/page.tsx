import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Issue, Project, Task } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { diffDays, fmtDate, fmtDateTime, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { allowedIssueSteps, issueCaps, issueFilter, peopleMap, projectCaps, taskFilter } from "@/lib/work-access";
import { cn } from "@/lib/cn";
import { Card, CardBody } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { AttachmentList } from "@/components/ui/file-upload";
import { PageBody } from "@/components/ui/page";
import { LinkTabs } from "@/components/ui/tabs";
import { CommentList, HistoryTimeline } from "../../tasks/_components/activity";
import { CommentBox } from "../../tasks/_components/comment-box";
import { SeverityLabel } from "../_components/severity";
import { addIssueComment } from "../actions";
import { AttachFiles } from "./attach-files";
import { IssueActions } from "./issue-actions";
import { TriageDialog } from "./triage-dialog";

export const metadata = { title: "Issue" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[13px]">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export default async function IssuePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const sp = await searchParams;
  const user = await requireUser();
  await connectDB();
  const issue = await Issue.findOne({ $and: [{ _id: id }, await issueFilter(user)] }).lean();
  if (!issue) notFound();

  const project = await Project.findById(issue.project, { projectNo: 1, title: 1, manager: 1, team: 1 }).lean();
  const caps = issueCaps(user, issue, project?.manager);
  const canOpenProject = project ? projectCaps(user, project).view : false;
  const [task, people, options] = await Promise.all([
    issue.task ? Task.findOne({ $and: [{ _id: issue.task }, await taskFilter(user)] }, { taskNo: 1, title: 1 }).lean() : null,
    peopleMap([issue.reporter, issue.assignee, issue.verifiedBy]),
    caps.manage ? peopleOptions() : [],
  ]);
  const steps = allowedIssueSteps(user, caps, issue);
  const tab = ["comments", "history"].includes(param(sp, "tab")) ? param(sp, "tab") : "comments";
  const today = todayKey();
  const working = ["open", "assigned", "in_progress", "reopened"].includes(issue.status);
  const late = Boolean(issue.targetDate && issue.targetDate < today && working);
  const tabHref = (t: string) => `/qa/${id}${t === "comments" ? "" : `?tab=${t}`}`;
  const person = (pid?: { toString(): string } | null) => (pid ? (people.get(pid.toString())?.name ?? "Unknown") : undefined);

  return (
    <PageBody>
      <div className="flex flex-col gap-1">
        <Link href="/qa" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-brand-600">
          ← QA &amp; issues
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{issue.issueNo}</span>
          <StatusChip domain="issue" value={issue.status} />
          <SeverityLabel value={issue.severity} />
          <StatusChip domain="priority" value={issue.priority} size="sm" />
          {issue.reopenCount > 0 && <span className="text-xs font-semibold text-danger">Reopened {issue.reopenCount}×</span>}
        </div>
        <h1 className="mt-1.5 font-display text-[22px] leading-tight font-semibold break-words text-ink sm:text-[26px]">{issue.title}</h1>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardBody className="flex flex-col gap-5 pt-5">
              <section aria-label="Description">
                {issue.description ? <p className="text-sm leading-relaxed break-words whitespace-pre-line text-ink-2">{issue.description}</p> : <p className="text-sm text-muted">No description provided.</p>}
              </section>
              {issue.stepsToReproduce && (
                <section aria-label="Steps to reproduce" className="flex flex-col gap-1.5">
                  <h2 className="font-sans text-[13px] font-semibold">Steps to reproduce</h2>
                  <p className="text-[13px] leading-relaxed break-words whitespace-pre-line text-ink-2">{issue.stepsToReproduce}</p>
                </section>
              )}
              {issue.environment && (
                <section aria-label="Environment" className="flex flex-col gap-1.5">
                  <h2 className="font-sans text-[13px] font-semibold">Environment</h2>
                  <p className="text-[13px] break-words text-ink-2">{issue.environment}</p>
                </section>
              )}
              {issue.resolution && (
                <section aria-label="Resolution" className="rounded-xl bg-success-bg px-4 py-3">
                  <h2 className="font-sans text-[13px] font-semibold text-[#0b5c40]">Resolution</h2>
                  <p className="mt-1 text-[13px] break-words whitespace-pre-line text-ink-2">{issue.resolution}</p>
                </section>
              )}
              <section aria-label="Attachments" className="flex flex-col gap-2">
                <h2 className="font-sans text-[13px] font-semibold">Screenshots and files</h2>
                <AttachmentList files={issue.attachments.map((a) => ({ file: a.file.toString(), name: a.name, size: a.size }))} empty="No files attached" />
                {(caps.manage || caps.isReporter || caps.isAssignee) && <AttachFiles issueId={id} />}
              </section>
            </CardBody>
          </Card>

          <Card>
            <div className="px-5 pt-1">
              <LinkTabs
                items={[
                  { href: tabHref("comments"), label: "Comments", count: issue.comments.length, active: tab === "comments" },
                  { href: tabHref("history"), label: "History", active: tab === "history" },
                ]}
              />
            </div>
            <CardBody className="pt-5">
              {tab === "comments" ? (
                <div className="flex flex-col gap-5">
                  <CommentList comments={issue.comments} />
                  <CommentBox action={addIssueComment.bind(null, id)} entityType="issue" entityId={id} />
                </div>
              ) : (
                <HistoryTimeline history={issue.history} />
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardBody className="flex flex-col gap-4 pt-5">
              <dl className="flex flex-col gap-2.5">
                <Row label="Project">
                  {project ? (
                    canOpenProject ? (
                      <Link href={`/projects/${project._id}`} className="text-brand-600 hover:text-brand-800">
                        {project.projectNo} · {project.title}
                      </Link>
                    ) : (
                      project.title
                    )
                  ) : (
                    "—"
                  )}
                </Row>
                {task && (
                  <Row label="Task">
                    <Link href={`/tasks/${task._id}`} className="text-brand-600 hover:text-brand-800">
                      {task.taskNo}
                    </Link>
                  </Row>
                )}
                <Row label="Reported">
                  {person(issue.reporter)} · {fmtDate(issue.reportedDate, "d MMM")}
                </Row>
                <Row label="Assigned to">{person(issue.assignee) ?? <span className="text-muted">Unassigned</span>}</Row>
                <Row label="Target">
                  {issue.targetDate ? (
                    <span className={cn(late && "font-semibold text-danger")}>
                      {fmtDate(issue.targetDate, "EEE d MMM")}
                      {late ? ` · ${diffDays(issue.targetDate, today)}d late` : ""}
                    </span>
                  ) : (
                    <span className="text-muted">Not set</span>
                  )}
                </Row>
                {issue.resolvedAt && <Row label="Fixed">{fmtDateTime(issue.resolvedAt)}</Row>}
                {issue.verifiedBy && <Row label="Verified by">{person(issue.verifiedBy)}</Row>}
                {issue.closedAt && <Row label="Closed">{fmtDateTime(issue.closedAt)}</Row>}
              </dl>
              {(steps.length > 0 || caps.manage) && (
                <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
                  <IssueActions issueId={id} steps={steps} />
                  {caps.manage && (
                    <TriageDialog
                      issueId={id}
                      people={options}
                      initial={{ severity: issue.severity, priority: issue.priority, targetDate: issue.targetDate ?? "", assignee: issue.assignee?.toString() ?? "" }}
                    />
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
