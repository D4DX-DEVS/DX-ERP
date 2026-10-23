import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Bug, CheckSquare, Flag, History, KeyRound, LayoutDashboard, Paperclip, Pencil, Plus, Users } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Contract, Invoice, Issue, Project, Proposal, Task, TimesheetEntry, type IProject, type ObjectId } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { inr } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { fmtDate, todayKey } from "@/lib/time";
import { isObjectId } from "@/lib/validation";
import { vaultRole } from "@/lib/vault/service";
import {
  canCreateTask,
  canSeeClient,
  categoryOf,
  ISSUE_RESOLVED_STATUSES,
  issueFilter,
  keysInCategories,
  peopleMap,
  projectCaps,
  taskFilter,
  type ProjectCaps,
  TASK_CLOSED_CATEGORIES,
} from "@/lib/work-access";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { OptionChip, StatusChip } from "@/components/ui/chip";
import { PageBody } from "@/components/ui/page";
import { LinkTabs } from "@/components/ui/tabs";
import { CommentList, HistoryTimeline } from "../../tasks/_components/activity";
import { CommentBox } from "../../tasks/_components/comment-box";
import { milestoneOverdue, projectHealth } from "../health";
import { HealthBadge } from "../project-ui";
import { projectTaskStats } from "../stats";
import { addProjectComment } from "../actions";
import { FilesPanel, type ProjectFileView } from "./files-panel";
import { MilestonesPanel, type MilestoneView } from "./milestones-panel";
import { Overview } from "./overview";
import { ProjectStatusControl } from "./project-actions";
import { TasksTab } from "./tasks-tab";
import { TeamPanel, type TeamMemberView } from "./team-panel";
import { VaultTab } from "./vault-tab";

export const metadata = { title: "Project" };

const TABS = ["overview", "tasks", "milestones", "team", "files", "secrets", "activity"] as const;
type Tab = (typeof TABS)[number];
const FLOW = ["pending", "in_progress", "client_review", "approved", "delivered"];

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span>
      {label} <strong className="font-semibold text-ink">{children}</strong>
    </span>
  );
}

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const sp = await searchParams;
  const user = await requireUser();
  await connectDB();
  const project = await Project.findById(id).lean();
  if (!project) notFound();
  const caps = projectCaps(user, project);
  if (!caps.view) forbidden();

  const settings = await getSettings();
  const today = todayKey();
  // The vault follows team membership only — org-wide project viewers don't get the Secrets tab.
  const secretsRole = vaultRole(user, project);
  const tabParam = param(sp, "tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam) && (tabParam !== "secrets" || secretsRole) ? (tabParam as Tab) : "overview";
  const closedTaskKeys = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const visibleTasks = await taskFilter(user);
  const category = categoryOf(settings.projectStatuses, project.status);
  const canDeleteProject = can(user, "projects.delete");

  const [stats, people, client, contract, proposal, taskCount, openIssues, hasWork] = await Promise.all([
    projectTaskStats([project._id], settings),
    peopleMap([project.manager, ...project.team.map((m) => m.user)]),
    project.client && !caps.restricted ? Client.findById(project.client, { name: 1, confidential: 1, owner: 1 }).lean() : null,
    project.contract && can(user, "contracts.view") ? Contract.findById(project.contract, { contractNo: 1 }).lean() : null,
    project.proposal && can(user, "proposals.view") ? Proposal.findById(project.proposal, { proposalNo: 1 }).lean() : null,
    Task.countDocuments({ $and: [{ project: project._id }, visibleTasks] }),
    (async () => Issue.countDocuments({ $and: [{ project: project._id }, caps.restricted ? await issueFilter(user) : {}, { status: { $nin: ISSUE_RESOLVED_STATUSES } }] }))(),
    canDeleteProject ? Promise.all([Task.exists({ project: project._id }), TimesheetEntry.exists({ project: project._id })]).then(([t, e]) => Boolean(t || e)) : false,
  ]);
  const progress = stats.get(id) ?? { progress: 0, total: 0, done: 0 };
  const health = projectHealth({ category, startDate: project.startDate, targetDate: project.targetDate, progress: progress.progress, milestones: project.milestones, today });
  const current = settings.projectStatuses.find((s) => s.key === project.status);
  const manager = project.manager ? people.get(project.manager.toString()) : undefined;
  const clientName = project.internal ? "Internal" : client ? (canSeeClient(user, client) ? client.name : "Restricted client") : undefined;

  const tabIcon = "size-[18px]";
  const tabItems = [
    { key: "overview", label: "Overview", Icon: LayoutDashboard },
    { key: "tasks", label: "Tasks", Icon: CheckSquare, count: taskCount },
    { key: "milestones", label: "Milestones", Icon: Flag, count: project.milestones.length || undefined },
    { key: "team", label: "Team", Icon: Users },
    { key: "files", label: "Files", Icon: Paperclip, count: project.attachments.length || undefined },
    ...(secretsRole ? [{ key: "secrets", label: "Secrets", Icon: KeyRound, count: undefined }] : []),
    { key: "activity", label: "Activity", Icon: History },
  ].map(({ Icon, ...t }) => ({
    href: t.key === "overview" ? `/projects/${id}` : `/projects/${id}?tab=${t.key}`,
    label: t.label,
    icon: <Icon className={tabIcon} />,
    count: t.count,
    active: tab === t.key,
  }));
  tabItems.push({ href: `/qa?project=${id}`, label: "QA issues", icon: <Bug className={tabIcon} />, count: openIssues || undefined, active: false });

  const statusChoices = settings.projectStatuses
    .filter((s) => s.category !== "cancelled" || canDeleteProject)
    .map((s) => ({ key: s.key, label: s.label, tone: s.tone }));
  const isCancelled = category === "cancelled";

  return (
    <PageBody>
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
          <Link href="/projects" className="hover:text-brand-600">
            Projects
          </Link>{" "}
          / {project.projectNo}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[22px] leading-tight font-semibold text-ink sm:text-[26px]">{project.title}</h1>
              <OptionChip options={settings.projectStatuses} value={project.status} />
              <HealthBadge health={health} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
              {clientName && <Meta label="Client">{clientName}</Meta>}
              <Meta label="PM">{manager?.name ?? "Not assigned"}</Meta>
              <span>
                {project.startDate ? fmtDate(project.startDate) : "No start"} – {project.targetDate ? fmtDate(project.targetDate) : "no target"}
              </span>
              <span>
                Priority <StatusChip domain="priority" value={project.priority} size="sm" />
              </span>
              {(contract || proposal) && (
                <span>
                  {contract ? `Contract ${contract.contractNo}` : ""}
                  {contract && proposal ? " · " : ""}
                  {proposal ? `${contract ? "from " : "Proposal "}${proposal.proposalNo}` : ""}
                </span>
              )}
            </div>
          </div>
          {/* One row on phones: secondary actions show only their icon there. */}
          <div className="flex flex-wrap items-center gap-2">
            {caps.manage && current && (
              <ProjectStatusControl
                projectId={id}
                current={{ key: current.key, label: current.label, tone: current.tone }}
                choices={statusChoices}
                canCancel={canDeleteProject && hasWork === true && !isCancelled}
                canDelete={canDeleteProject && hasWork === false}
              />
            )}
            {caps.manage && (
              <ButtonLink href={`/projects/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" aria-hidden />} className="max-sm:w-9 max-sm:px-0">
                <span className="max-sm:sr-only">Edit</span>
              </ButtonLink>
            )}
            {canCreateTask(user, project) && (
              <ButtonLink href={`/tasks/new?project=${id}`} icon={<Plus className="size-4" aria-hidden />}>
                Add task
              </ButtonLink>
            )}
          </div>
        </div>
      </div>

      <LinkTabs items={tabItems} />

      {tab === "overview" && <Overview user={user} project={project} caps={caps} settings={settings} stats={progress} />}

      {tab === "tasks" && <TasksTab user={user} project={project} settings={settings} sp={sp} />}

      {tab === "milestones" && <MilestonesTab project={project} caps={caps} today={today} />}

      {tab === "team" && <TeamTab project={project} caps={caps} closedTaskKeys={closedTaskKeys} people={people} />}

      {tab === "files" && <FilesPanel projectId={id} files={await projectFiles(project.attachments, caps.manage, user.id)} />}

      {tab === "secrets" && secretsRole && <VaultTab user={user} role={secretsRole} project={project} />}

      {tab === "activity" && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Comments" />
            <CardBody className="flex flex-col gap-5">
              <CommentList comments={project.comments} />
              <CommentBox action={addProjectComment.bind(null, id)} entityType="project" entityId={id} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" subtitle="Status changes, milestones and team updates" />
            <CardBody>
              <HistoryTimeline history={project.history} />
            </CardBody>
          </Card>
        </div>
      )}
    </PageBody>
  );
}

async function projectFiles(attachments: { _id?: ObjectId; file: ObjectId; name: string; size?: number; uploadedAt?: Date; uploadedBy?: ObjectId }[], canManage: boolean, userId: string): Promise<ProjectFileView[]> {
  const people = await peopleMap(attachments.map((a) => a.uploadedBy));
  return [...attachments].reverse().map((a, i) => ({
    refId: a._id?.toString() ?? String(i),
    file: a.file.toString(),
    name: a.name,
    size: a.size,
    by: (a.uploadedBy && people.get(a.uploadedBy.toString())?.name) || "Unknown",
    when: fmtDate(a.uploadedAt),
    canRemove: canManage || a.uploadedBy?.toString() === userId,
  }));
}

async function MilestonesTab({ project, caps, today }: { project: Pick<IProject, "_id" | "milestones">; caps: ProjectCaps; today: string }) {
  const invoiceIds = project.milestones.map((m) => m.invoice).filter((x): x is ObjectId => Boolean(x));
  const invoices = caps.financials && invoiceIds.length ? await Invoice.find({ _id: { $in: invoiceIds } }, { invoiceNo: 1, draftNo: 1, status: 1 }).lean() : [];
  const invoiceMap = new Map(invoices.map((i) => [i._id.toString(), i]));
  const views: MilestoneView[] = [...project.milestones]
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .map((m) => {
      const overdue = milestoneOverdue(m, today);
      const inv = m.invoice ? invoiceMap.get(m.invoice.toString()) : undefined;
      const idx = FLOW.indexOf(m.status);
      const next = m.status === "delayed" ? "in_progress" : FLOW[idx + 1];
      return {
        id: m._id.toString(),
        title: m.title,
        description: m.description ?? "",
        dueDate: m.dueDate ?? "",
        dueLabel: m.dueDate ? fmtDate(m.dueDate) : "no date",
        status: m.status,
        displayStatus: overdue ? "delayed" : m.status,
        amount: caps.financials ? m.amount : undefined,
        amountLabel: caps.financials && m.amount ? inr(m.amount) : undefined,
        deliveredLabel: m.deliveredAt ? fmtDate(m.deliveredAt) : undefined,
        clientReviewNote: m.clientReviewNote ?? "",
        approvedBy: m.approvedBy ?? "",
        releaseNotes: m.releaseNotes ?? "",
        deliveredAt: m.deliveredAt ?? "",
        invoiceLabel: inv ? (inv.invoiceNo ?? inv.draftNo) : undefined,
        invoiceStatus: inv?.status,
        nextLabel: next ? statusLabel("milestone", next) : undefined,
      };
    });
  return <MilestonesPanel projectId={project._id.toString()} milestones={views} canManage={caps.manage} showAmount={caps.financials} />;
}

async function TeamTab({
  project,
  caps,
  closedTaskKeys,
  people,
}: {
  project: Pick<IProject, "_id" | "team" | "manager">;
  caps: ProjectCaps;
  closedTaskKeys: string[];
  people: Awaited<ReturnType<typeof peopleMap>>;
}) {
  const [openRows, options] = await Promise.all([
    Task.aggregate<{ _id: ObjectId; n: number }>([
      { $match: { project: project._id, status: { $nin: closedTaskKeys } } },
      { $unwind: "$assignees" },
      { $group: { _id: "$assignees", n: { $sum: 1 } } },
    ]),
    caps.manage ? peopleOptions() : [],
  ]);
  const openMap = new Map(openRows.map((r) => [r._id.toString(), r.n]));
  const members: TeamMemberView[] = project.team.map((m) => ({
    userId: m.user.toString(),
    name: people.get(m.user.toString())?.name ?? "Unknown",
    photo: people.get(m.user.toString())?.photo,
    role: m.role ?? "",
    allocation: m.allocation,
    openTasks: openMap.get(m.user.toString()) ?? 0,
  }));
  const onTeam = new Set(members.map((m) => m.userId));
  const manager = project.manager ? people.get(project.manager.toString()) : undefined;
  return <TeamPanel projectId={project._id.toString()} manager={manager ? { name: manager.name, photo: manager.photo } : undefined} members={members} people={options.filter((p) => !onTeam.has(p.id))} canManage={caps.manage} />;
}
