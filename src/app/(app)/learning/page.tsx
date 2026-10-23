import type { Metadata } from "next";
import { BookOpen, ExternalLink, FileText, GraduationCap, Link2, ListChecks, PlayCircle } from "lucide-react";
import type { ReactNode } from "react";
import { can, isInternLike, requireUser, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Department, LearningResource, User, type ILearningResource } from "@/lib/models";
import { EXITED_STATUSES, peopleOptions } from "@/lib/people";
import { param, type SearchParams } from "@/lib/query";
import { fmtDate, todayKey } from "@/lib/time";
import { ActionButton } from "@/components/ui/actions";
import { PersonCell } from "@/components/ui/avatar";
import { AttachmentList } from "@/components/ui/file-upload";
import { Card, CardBody, CardHeader, DetailList } from "@/components/ui/card";
import { Chip, Tag } from "@/components/ui/chip";
import { EmptyState, PageBody, PageHeader, Progress, SectionTitle, StatCard } from "@/components/ui/page";
import { LinkTabs } from "@/components/ui/tabs";
import { Td, Th, THead, TableWrap, Tr } from "@/components/ui/table";
import { internshipProgress } from "../staff/_lib/constants";
import { ObjectivesPanel } from "../interns/_components/objectives-panel";
import { ReviewCard } from "../interns/_components/review-card";
import { loadReviews } from "../interns/_lib/reviews";
import { setResourceActive } from "./actions";
import { CompleteButton } from "./_components/complete-button";
import { ResourceFormButton, type ResourceFormValues } from "./_components/resource-form";
import { KINDS } from "./_lib/kinds";
import { resourceAppliesTo, visibleResourceFilter } from "./_lib/visibility";

export const metadata: Metadata = { title: "Learning" };

const KIND_ICONS: Record<string, ReactNode> = {
  document: <FileText className="size-[18px]" />,
  video: <PlayCircle className="size-[18px]" />,
  link: <Link2 className="size-[18px]" />,
  course: <GraduationCap className="size-[18px]" />,
  activity: <ListChecks className="size-[18px]" />,
};

const AUDIENCE_LABELS: Record<string, string> = { all: "Everyone", employee: "Employees", trainee: "Trainees", intern: "Interns" };

type Resource = ILearningResource & { _id: import("mongoose").Types.ObjectId };

export default async function LearningPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await connectDB();
  const manager = can(user, "interns.manage");
  const learner = isInternLike(user);

  const keys = ["library", ...(manager ? ["matrix"] : []), ...(learner ? ["internship"] : [])];
  const labels: Record<string, string> = { library: "Library", matrix: "Completion matrix", internship: "Internship & reviews" };
  const requested = param(sp, "tab");
  const tab = keys.includes(requested) ? requested : "library";
  const tabs = keys.map((k) => ({ href: k === "library" ? "/learning" : `/learning?tab=${k}`, label: labels[k], active: tab === k }));

  return (
    <PageBody>
      <PageHeader
        overline={learner ? "Internship" : "Work"}
        title={learner ? "Learning & reviews" : "Learning"}
        description="Approved training materials and learning activities."
        actions={manager ? <ManagerActions /> : undefined}
      />
      {tabs.length > 1 && <LinkTabs items={tabs} />}
      {tab === "library" && <LibraryView user={user} manager={manager} />}
      {tab === "matrix" && manager && <MatrixView />}
      {tab === "internship" && learner && <InternshipView user={user} />}
    </PageBody>
  );
}

async function ManagerActions() {
  const [departments, people] = await Promise.all([Department.find({ active: true }, { name: 1 }).sort({ name: 1 }).lean(), peopleOptions()]);
  return <ResourceFormButton departments={departments.map((d) => ({ id: d._id.toString(), name: d.name }))} people={people} />;
}

/* ---------------------------------------------------------------- */

async function LibraryView({ user, manager }: { user: CurrentUser; manager: boolean }) {
  const today = todayKey();
  const me = { id: user.id, personType: user.personType, department: user.departmentId };
  const resources = (
    manager
      ? await LearningResource.find({}).sort({ active: -1, createdAt: -1 }).limit(200).lean()
      : await LearningResource.find(visibleResourceFilter({ id: user._id, personType: user.personType, department: user.departmentId })).sort({ dueDate: 1, createdAt: -1 }).limit(200).lean()
  ) as Resource[];

  const [departments, people, learners] = manager
    ? await Promise.all([
        Department.find({}, { name: 1, active: 1 }).sort({ name: 1 }).lean(),
        peopleOptions(),
        User.find({ personType: { $in: ["employee", "trainee", "intern"] }, status: { $nin: EXITED_STATUSES } }, { personType: 1, department: 1 }).lean(),
      ])
    : [[], [], []];
  const deptName = new Map(departments.map((d) => [d._id.toString(), d.name]));

  const mineApplies = (r: Resource) => resourceAppliesTo(r, me);
  const mineDone = (r: Resource) => r.completions.find((c) => c.user.toString() === user.id);
  const mine = resources.filter((r) => r.active && mineApplies(r));
  const done = mine.filter((r) => mineDone(r)).length;
  const overdue = mine.filter((r) => !mineDone(r) && r.dueDate && r.dueDate < today).length;

  const departmentOptions = departments.filter((d) => d.active).map((d) => ({ id: d._id.toString(), name: d.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {manager ? (
          <>
            <StatCard label="Active resources" value={resources.filter((r) => r.active).length} sub={`${resources.filter((r) => !r.active).length} inactive`} />
            <StatCard label="Completions recorded" value={resources.reduce((s, r) => s + r.completions.length, 0)} />
            <StatCard label="Assigned to me" value={mine.length} sub={`${done} completed`} />
          </>
        ) : (
          <>
            <StatCard label="Available to me" value={mine.length} />
            <StatCard label="Completed" value={done} sub={mine.length ? `${Math.round((done / mine.length) * 100)}% of ${mine.length}` : undefined} />
            <StatCard label="Overdue" value={overdue} tone={overdue > 0 ? "alert" : "default"} />
          </>
        )}
      </div>

      {resources.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="No learning resources yet"
            description={manager ? "Add training materials and learning activities for interns, trainees and staff." : "Approved training materials will appear here when they are shared with you."}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {resources.map((r) => {
            const id = r._id.toString();
            const completion = mineDone(r);
            const applies = r.active && mineApplies(r);
            const late = applies && !completion && r.dueDate && r.dueDate < today;
            let applicable = 0;
            let completed = 0;
            if (manager) {
              const ids = new Set<string>();
              for (const l of learners) {
                if (resourceAppliesTo(r, { id: l._id.toString(), personType: l.personType, department: l.department?.toString() })) {
                  ids.add(l._id.toString());
                }
              }
              applicable = ids.size;
              completed = r.completions.filter((c) => ids.has(c.user.toString())).length;
            }
            const initial: ResourceFormValues | undefined = manager
              ? {
                  id,
                  title: r.title,
                  description: r.description,
                  kind: r.kind,
                  url: r.url,
                  attachments: r.attachments.map((a) => ({ id: a.file.toString(), name: a.name, size: a.size ?? 0, mime: a.mime ?? "" })),
                  audience: r.audience,
                  department: r.department?.toString(),
                  assignedTo: r.assignedTo.map((a) => a.toString()),
                  dueDate: r.dueDate,
                  estimatedHours: r.estimatedHours,
                }
              : undefined;
            return (
              <Card key={id} className={r.active ? undefined : "bg-field/60"}>
                <CardBody className="flex h-full flex-col gap-3 pt-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">{KIND_ICONS[r.kind] ?? KIND_ICONS.link}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-[15px] leading-snug font-semibold text-ink">{r.title}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Tag tone="blue">{KINDS.find((k) => k.value === r.kind)?.label ?? r.kind}</Tag>
                        {!r.active && <Tag tone="gray">Inactive</Tag>}
                        {r.estimatedHours ? <span className="text-xs text-muted">~{r.estimatedHours} h</span> : null}
                        {r.dueDate && <span className={late ? "text-xs font-semibold text-danger" : "text-xs text-muted"}>Due {fmtDate(r.dueDate)}</span>}
                      </div>
                    </div>
                  </div>
                  {r.description && <p className="line-clamp-4 text-[13px] leading-relaxed whitespace-pre-line text-ink-2">{r.description}</p>}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold break-all text-brand-600 hover:underline">
                      <ExternalLink className="size-3.5 shrink-0" /> Open resource
                    </a>
                  )}
                  {r.attachments.length > 0 && <AttachmentList files={r.attachments.map((a) => ({ file: a.file.toString(), name: a.name, size: a.size }))} />}
                  {manager && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {r.audience.map((a) => (
                        <Tag key={a} tone="gray">
                          {AUDIENCE_LABELS[a] ?? a}
                        </Tag>
                      ))}
                      {r.department && <Tag tone="gray">{deptName.get(r.department.toString()) ?? "Department"}</Tag>}
                      {r.assignedTo.length > 0 && <span>{r.assignedTo.length} assigned</span>}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
                    <div className="flex min-w-0 flex-col gap-0.5 text-xs">
                      {completion ? (
                        <>
                          <Chip tone="green" size="sm">
                            Completed {fmtDate(completion.at)}
                          </Chip>
                          {completion.note && <span className="text-muted">“{completion.note}”</span>}
                        </>
                      ) : manager ? (
                        <span className="text-muted tabular">
                          {completed} of {applicable} completed
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {applies && !completion && <CompleteButton resourceId={id} title={r.title} />}
                      {manager && initial && (
                        <>
                          <ResourceFormButton departments={departmentOptions} people={people} initial={initial} />
                          <ActionButton size="sm" variant="secondary" action={setResourceActive.bind(null, id, !r.active)} successMessage={r.active ? "Resource deactivated" : "Resource reactivated"}>
                            {r.active ? "Deactivate" : "Reactivate"}
                          </ActionButton>
                        </>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

async function MatrixView() {
  const [resources, people] = await Promise.all([
    LearningResource.find({ active: true }).sort({ createdAt: -1 }).limit(12).lean() as Promise<Resource[]>,
    User.find({ personType: { $in: ["trainee", "intern"] }, status: { $nin: EXITED_STATUSES }, "internship.status": { $in: ["registered", "active", "extended"] } }, { name: 1, photo: 1, employeeId: 1, personType: 1, department: 1 })
      .sort({ name: 1 })
      .limit(150)
      .lean(),
  ]);
  const today = todayKey();

  return (
    <Card>
      <CardHeader title="Completion matrix" subtitle="Active interns and trainees against the 12 newest active resources" />
      {resources.length === 0 || people.length === 0 ? (
        <EmptyState title="Nothing to show yet" description={resources.length === 0 ? "Add learning resources to track completion." : "There are no active interns or trainees."} />
      ) : (
        <TableWrap>
          <THead>
            <Th>Intern / trainee</Th>
            {resources.map((r) => (
              <Th key={r._id.toString()} align="center" className="max-w-28 !whitespace-normal" title={r.title}>
                <span className="line-clamp-2">{r.title}</span>
              </Th>
            ))}
            <Th align="right">Done</Th>
          </THead>
          <tbody>
            {people.map((p) => {
              const pid = p._id.toString();
              let applicable = 0;
              let completed = 0;
              const cells = resources.map((r) => {
                if (!resourceAppliesTo(r, { id: pid, personType: p.personType, department: p.department?.toString() })) return <Td key={r._id.toString()} align="center" className="text-subtle">–</Td>;
                applicable++;
                const c = r.completions.find((x) => x.user.toString() === pid);
                if (c) {
                  completed++;
                  return (
                    <Td key={r._id.toString()} align="center" className="font-semibold text-success" title={`Completed ${fmtDate(c.at)}`}>
                      ✓
                    </Td>
                  );
                }
                const late = r.dueDate && r.dueDate < today;
                return (
                  <Td key={r._id.toString()} align="center" className={late ? "font-semibold text-danger" : "text-muted"} title={late ? "Overdue" : "Pending"}>
                    {late ? "!" : "·"}
                  </Td>
                );
              });
              return (
                <Tr key={pid}>
                  <Td>
                    <PersonCell name={p.name} sub={p.employeeId} photo={p.photo} href={`/interns/${pid}`} />
                  </Td>
                  {cells}
                  <Td align="right" className="tabular">
                    {completed} / {applicable}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
      <p className="border-t border-line-soft px-5 py-3 text-xs text-muted">✓ completed · “·” pending · “!” overdue · “–” not applicable</p>
    </Card>
  );
}

/* ---------------------------------------------------------------- */

async function InternshipView({ user }: { user: CurrentUser }) {
  const today = todayKey();
  const me = await User.findById(user._id).select("-salary -salaryHistory -bank -googleSub -internship.stipend -internship.stipendHistory").lean();
  const internship = me?.internship;
  if (!me || !internship) {
    return (
      <Card>
        <EmptyState icon={<GraduationCap className="size-5" />} title="No internship record yet" description="HR will set up your internship details — mentor, dates and objectives." />
      </Card>
    );
  }
  const [mentor, reviews] = await Promise.all([
    internship.mentor ? User.findById(internship.mentor, { name: 1, photo: 1, employeeId: 1, email: 1, designation: 1 }).lean() : null,
    loadReviews(user._id, true),
  ]);
  const progress = internshipProgress(internship.startDate, internship.endDate, today);
  const objectives = internship.objectives.map((o) => ({ id: o._id?.toString() ?? o.text, text: o.text, status: o.status }));
  const achieved = objectives.filter((o) => o.status === "achieved").length;
  const pending = reviews.filter((r) => !r.acknowledgedAt).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Internship progress" />
          <CardBody className="flex flex-col gap-3">
            {internship.startDate && internship.endDate ? (
              <>
                <div className="flex flex-wrap justify-between gap-2 text-[13px]">
                  <span>
                    <span className="text-muted">Started</span> <strong>{fmtDate(internship.startDate)}</strong>
                  </span>
                  <span>
                    <span className="text-muted">Expected completion</span> <strong>{fmtDate(internship.endDate)}</strong>
                  </span>
                </div>
                <Progress value={progress.pct} tone={progress.pct >= 100 ? "green" : "brand"} className="h-2.5" />
                <p className="text-[13px] text-ink-2">
                  {!progress.started ? `Starts ${fmtDate(internship.startDate)}` : progress.finished ? "The planned period is over." : `${progress.daysLeft} ${progress.daysLeft === 1 ? "day" : "days"} to go`}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-muted">Start and end dates have not been set yet.</p>
            )}
            <div className="border-t border-line-soft pt-3">
              <div className="mb-2 text-[13px] font-semibold text-ink-2">
                Objectives · {achieved} of {objectives.length} met
              </div>
              <ObjectivesPanel userId={user.id} objectives={objectives} canEdit={false} />
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your mentor" />
          <CardBody className="flex flex-col gap-3">
            {mentor ? (
              <>
                <PersonCell name={mentor.name} sub={mentor.employeeId} photo={mentor.photo} />
                <a href={`mailto:${mentor.email}`} className="inline-flex h-10 items-center justify-center rounded-[10px] border border-line-strong text-[13px] font-semibold text-ink hover:bg-field">
                  Message mentor
                </a>
              </>
            ) : (
              <p className="text-[13px] text-muted">A mentor has not been assigned yet.</p>
            )}
            <DetailList
              columns={1}
              items={[
                { label: "Status", value: <Chip tone={internship.status === "completed" ? "green" : "blue"}>{internship.status.replace(/^\w/, (c) => c.toUpperCase())}</Chip> },
                { label: "Certificate", value: internship.certificateStatus === "issued" ? "Issued" : internship.certificateStatus === "none" ? "Not requested" : internship.certificateStatus.replace(/^\w/, (c) => c.toUpperCase()) },
              ]}
            />
            <a href={`/interns/${user.id}?tab=completion`} className="text-[13px] font-semibold text-brand-600 hover:underline">
              Completion & certificate →
            </a>
          </CardBody>
        </Card>
      </div>

      <SectionTitle>
        Evaluations shared with you
        {pending > 0 && <span className="ml-2 text-sm font-medium text-warning">{pending} to acknowledge</span>}
      </SectionTitle>
      {reviews.length === 0 ? (
        <Card>
          <EmptyState title="No evaluations shared yet" description="Your mentor will share progress evaluations here. You can acknowledge each one and leave a comment." />
        </Card>
      ) : (
        reviews.map((r) => (
          <ReviewCard key={r.id} review={r} userId={user.id} firstName={user.name.split(" ")[0] ?? user.name} today={today} viewerId={user.id} isSelf canEvaluate={false} canManage={false} />
        ))
      )}
    </div>
  );
}
