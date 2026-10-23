import Link from "next/link";
import { Expense, Invoice, Issue, Payment, Task, TimesheetEntry, type IProject, type ObjectId } from "@/lib/models";
import { can, type CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { inr, inrCompact } from "@/lib/format";
import { statusLabel, statusTone, TONE_CLASSES } from "@/lib/status";
import { diffDays, fmtDate, formatHours, monthKey, monthRange, todayKey } from "@/lib/time";
import { ISSUE_RESOLVED_STATUSES, issueFilter, keysInCategories, peopleMap, taskFilter, TASK_CLOSED_CATEGORIES, type Filter, type ProjectCaps } from "@/lib/work-access";
import { Chip, StatusChip } from "@/components/ui/chip";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress, StatCard } from "@/components/ui/page";
import { TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { EffortBar, hoursLabel } from "../../tasks/_components/effort";
import { milestoneOverdue } from "../health";
import type { ProjectTaskStats } from "../stats";

type ProjectDoc = Pick<IProject, "_id" | "projectNo" | "title" | "manager" | "team" | "milestones" | "budget" | "estimatedHours" | "description" | "scope" | "deliverables">;

function Dot({ done, now, overdue }: { done: boolean; now: boolean; overdue: boolean }) {
  return (
    <span
      className={cn(
        "box-border size-4 shrink-0 rounded-full",
        done && "bg-chart-3",
        !done && now && !overdue && "border-4 border-chart-1 bg-white",
        !done && now && overdue && "border-4 border-danger bg-white",
        !done && !now && "bg-[#c9cfdf]",
      )}
      aria-hidden
    />
  );
}

/** Overview tab: progress, milestones, task status, overdue work, workload, effort, QA and (with permission) billing. */
export async function Overview({
  user,
  project,
  caps,
  settings,
  stats,
}: {
  user: CurrentUser;
  project: ProjectDoc;
  caps: ProjectCaps;
  settings: AppSettings;
  stats: ProjectTaskStats;
}) {
  const today = todayKey();
  const closedTaskKeys = keysInCategories(settings.taskStatuses, TASK_CLOSED_CATEGORIES);
  const visibleTasks = await taskFilter(user);
  // Task titles follow the task visibility rules (FRS §11.4): `projects.view_all` alone does not show other people's tasks.
  const scope: Filter = caps.restricted || !can(user, "tasks.view_all") ? { $and: [{ project: project._id }, visibleTasks] } : { project: project._id };
  const month = monthRange(monthKey());
  const projectId = project._id;
  const issueScope: Filter = caps.restricted ? { $and: [{ project: projectId }, await issueFilter(user)] } : { project: projectId };

  const [statusRows, overdueTasks, overdueCount, openByPerson, loggedThisMonth, loggedTotal, loggedByTask, issueRows] = await Promise.all([
    Task.aggregate<{ _id: string; n: number }>([{ $match: { ...scope, parent: null } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Task.find({ ...scope, status: { $nin: closedTaskKeys }, dueDate: { $lt: today } }, { taskNo: 1, title: 1, status: 1, dueDate: 1 }).sort({ dueDate: 1 }).limit(6).lean(),
    Task.countDocuments({ ...scope, status: { $nin: closedTaskKeys }, dueDate: { $lt: today } }),
    caps.restricted
      ? []
      : Task.aggregate<{ _id: ObjectId; open: number; estimate: number }>([
          { $match: { project: projectId, status: { $nin: closedTaskKeys } } },
          { $unwind: "$assignees" },
          { $group: { _id: "$assignees", open: { $sum: 1 }, estimate: { $sum: "$estimateHours" } } },
        ]),
    caps.restricted
      ? []
      : TimesheetEntry.aggregate<{ _id: ObjectId; minutes: number }>([
          { $match: { project: projectId, date: { $gte: month.from, $lte: month.to }, status: { $ne: "rejected" } } },
          { $group: { _id: "$user", minutes: { $sum: "$minutes" } } },
        ]),
    caps.restricted ? [] : TimesheetEntry.aggregate<{ _id: null; minutes: number }>([{ $match: { project: projectId, status: { $ne: "rejected" } } }, { $group: { _id: null, minutes: { $sum: "$minutes" } } }]),
    caps.restricted
      ? []
      : TimesheetEntry.aggregate<{ _id: ObjectId; minutes: number }>([
          { $match: { project: projectId, task: { $ne: null }, status: { $ne: "rejected" } } },
          { $group: { _id: "$task", minutes: { $sum: "$minutes" } } },
          { $sort: { minutes: -1 } },
          { $limit: 8 },
        ]),
    Issue.aggregate<{ _id: string; n: number }>([{ $match: { ...issueScope, status: { $nin: ISSUE_RESOLVED_STATUSES } } }, { $group: { _id: "$severity", n: { $sum: 1 } } }]),
  ]);

  const perTaskDocs = loggedByTask.length ? await Task.find({ _id: { $in: loggedByTask.map((r) => r._id) } }, { taskNo: 1, title: 1, estimateHours: 1 }).lean() : [];
  const perTask = new Map(perTaskDocs.map((t) => [t._id.toString(), t]));

  const workloadIds = [project.manager, ...project.team.map((m) => m.user), ...openByPerson.map((r) => r._id)];
  const people = await peopleMap(workloadIds);
  const openMap = new Map(openByPerson.map((r) => [r._id.toString(), r]));
  const loggedMap = new Map(loggedThisMonth.map((r) => [r._id.toString(), r.minutes]));
  const memberIds = [...new Set([...project.team.map((m) => m.user.toString()), ...openByPerson.map((r) => r._id.toString())])];
  const roleOf = new Map(project.team.map((m) => [m.user.toString(), `${m.role || "Member"} · ${m.allocation}%`]));

  const totalHours = (loggedTotal[0]?.minutes ?? 0) / 60;
  const estimate = project.estimatedHours;
  const openIssues = issueRows.reduce((s, r) => s + r.n, 0);
  const criticalIssues = issueRows.find((r) => r._id === "critical")?.n ?? 0;
  const majorIssues = issueRows.find((r) => r._id === "major")?.n ?? 0;
  const statusCounts = new Map(statusRows.map((r) => [r._id, r.n]));
  const statusTotal = statusRows.reduce((s, r) => s + r.n, 0);

  // Billing (restricted to users with `projects.financials`)
  let billing: { invoiced: number; received: number; expenses: number; invoices: Map<string, { number: string; status: string }> } | null = null;
  if (caps.financials) {
    const invoiceIds = project.milestones.map((m) => m.invoice).filter((x): x is ObjectId => Boolean(x));
    const [invoiceTotals, payments, expenseTotals, invoiceDocs] = await Promise.all([
      Invoice.aggregate<{ _id: null; total: number }>([{ $match: { project: projectId, status: { $nin: ["cancelled", "draft"] } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
      Payment.aggregate<{ _id: string; total: number }>([{ $match: { project: projectId } }, { $group: { _id: "$type", total: { $sum: "$amount" } } }]),
      Expense.aggregate<{ _id: null; total: number }>([{ $match: { project: projectId, status: { $in: ["approved", "paid"] } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      invoiceIds.length ? Invoice.find({ _id: { $in: invoiceIds } }, { invoiceNo: 1, draftNo: 1, status: 1 }).lean() : [],
    ]);
    const paid = payments.find((p) => p._id === "payment")?.total ?? 0;
    const refunded = payments.find((p) => p._id === "refund")?.total ?? 0;
    billing = {
      invoiced: invoiceTotals[0]?.total ?? 0,
      received: paid - refunded,
      expenses: expenseTotals[0]?.total ?? 0,
      invoices: new Map(invoiceDocs.map((i) => [i._id.toString(), { number: i.invoiceNo ?? i.draftNo, status: i.status }])),
    };
  }

  const milestones = [...project.milestones].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const currentIndex = milestones.findIndex((m) => m.status !== "delivered");
  const elapsedNote = estimate > 0 && stats.progress > 0 ? `${Math.round((totalHours / estimate) * 100)}% used at ${stats.progress}% done` : estimate > 0 ? `${Math.round((totalHours / estimate) * 100)}% of estimate used` : "No estimate set";

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Progress" value={`${stats.progress}%`} sub={<Progress value={stats.progress} className="mt-1" />} />
        <StatCard
          label="Tasks done"
          href={`/projects/${project._id}?tab=tasks`}
          value={
            <>
              {stats.done} <span className="text-sm font-medium text-muted">/ {stats.total}</span>
            </>
          }
          sub={overdueCount > 0 ? <span className="font-semibold text-danger">{overdueCount} overdue</span> : "None overdue"}
        />
        {!caps.restricted && (
          <StatCard
            label="Effort · actual / estimate"
            value={
              <>
                {hoursLabel(Math.round(totalHours * 10) / 10)} <span className="text-sm font-medium text-muted">/ {estimate > 0 ? `${hoursLabel(estimate)} h` : "—"}</span>
              </>
            }
            sub={elapsedNote}
          />
        )}
        <StatCard
          label="Open QA issues"
          href={`/qa?project=${project._id}`}
          value={openIssues}
          sub={criticalIssues + majorIssues > 0 ? <span className="font-semibold text-outside">{criticalIssues} critical · {majorIssues} major</span> : "No serious defects"}
        />
        {billing && (
          <StatCard
            label="Billed"
            value={inrCompact(billing.invoiced)}
            sub={project.budget > 0 ? `of ${inrCompact(project.budget)} budget` : "No budget set"}
            icon={<span className="text-[10px] font-bold">₹</span>}
          />
        )}
      </div>

      {(project.description || project.scope || project.deliverables.length > 0) && (
        <Card>
          <CardHeader title="About this project" />
          <CardBody className="grid gap-5 text-sm sm:grid-cols-2">
            {project.description && (
              <section>
                <h3 className="mb-1 font-sans text-[13px] font-semibold text-ink-2">Description</h3>
                <p className="whitespace-pre-line text-ink-2">{project.description}</p>
              </section>
            )}
            {project.scope && (
              <section>
                <h3 className="mb-1 font-sans text-[13px] font-semibold text-ink-2">Scope</h3>
                <p className="whitespace-pre-line text-ink-2">{project.scope}</p>
              </section>
            )}
            {project.deliverables.length > 0 && (
              <section className="sm:col-span-2">
                <h3 className="mb-1 font-sans text-[13px] font-semibold text-ink-2">Deliverables</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-ink-2">
                  {project.deliverables.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </section>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Milestones & delivery" href={`/projects/${project._id}?tab=milestones`} hrefLabel="Manage" />
        <CardBody>
          {milestones.length === 0 ? (
            <p className="text-[13px] text-muted">No milestones yet.</p>
          ) : (
            <ol className="grid grid-cols-2 gap-x-0 gap-y-4 pb-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {milestones.map((m, i) => {
                const overdue = milestoneOverdue(m, today);
                const display = overdue ? "delayed" : m.status;
                return (
                  <li key={m._id.toString()} className="flex flex-col gap-2 pr-3">
                    <div className="flex items-center">
                      <Dot done={m.status === "delivered"} now={i === currentIndex} overdue={overdue} />
                      <span className={cn("ml-1 h-[3px] flex-1 rounded-sm", i === milestones.length - 1 ? "bg-transparent" : m.status === "delivered" ? "bg-chart-3" : "bg-line")} aria-hidden />
                    </div>
                    <div className="text-sm font-semibold">{m.title}</div>
                    <div className="text-xs text-muted">
                      {m.status === "delivered" ? `Delivered ${fmtDate(m.deliveredAt)}` : m.dueDate ? `Due ${fmtDate(m.dueDate, "d MMM")}${overdue ? ` · ${diffDays(m.dueDate, today)}d late` : ""}` : "No due date"}
                    </div>
                    <Chip tone={statusTone("milestone", display)} size="sm" className="self-start">
                      {statusLabel("milestone", display)}
                    </Chip>
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Task status" />
          <CardBody className="flex flex-col gap-3.5">
            {statusTotal === 0 ? (
              <p className="text-[13px] text-muted">No tasks yet.</p>
            ) : (
              <>
                <div className="flex h-4 gap-0.5 overflow-hidden rounded" role="img" aria-label="Task status breakdown">
                  {settings.taskStatuses
                    .filter((s) => statusCounts.get(s.key))
                    .map((s) => (
                      <span key={s.key} title={`${s.label} ${statusCounts.get(s.key)}`} className={cn("h-full", TONE_CLASSES[s.tone].dot)} style={{ flex: statusCounts.get(s.key) }} />
                    ))}
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
                  {settings.taskStatuses
                    .filter((s) => statusCounts.get(s.key))
                    .map((s) => (
                      <li key={s.key} className="flex items-center gap-1.5">
                        <span className={cn("size-2.5 rounded-[3px]", TONE_CLASSES[s.tone].dot)} aria-hidden />
                        {s.label} {statusCounts.get(s.key)}
                      </li>
                    ))}
                </ul>
              </>
            )}
            <div className="border-t border-line-soft pt-3">
              <h3 className="mb-2 font-sans text-[13px] font-semibold text-ink-2">Overdue{overdueCount > 0 ? ` · ${overdueCount}` : ""}</h3>
              {overdueTasks.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing is overdue.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {overdueTasks.map((t) => (
                    <li key={t._id.toString()}>
                      <Link href={`/tasks/${t._id}`} className="flex items-center justify-between gap-3 text-[13px] hover:text-brand-600">
                        <span className="min-w-0 break-words">
                          <span className="mr-1.5 font-mono text-[11px] text-muted">{t.taskNo}</span>
                          {t.title}
                        </span>
                        <span className="shrink-0 font-semibold text-danger">{diffDays(t.dueDate!, today)}d</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardBody>
        </Card>

        {!caps.restricted && (
          <Card>
            <CardHeader title="Team workload" subtitle={`Open work and hours logged in ${fmtDate(month.from, "MMMM")}`} />
            {memberIds.length === 0 && !project.manager ? (
              <CardBody>
                <p className="text-[13px] text-muted">No team members yet.</p>
              </CardBody>
            ) : (
              <TableWrap tablet={[1, 2, 3, 4]}>
                <THead>
                  <Th>Person</Th>
                  <Th align="right">Open tasks</Th>
                  <Th align="right">Estimate</Th>
                  <Th align="right">This month</Th>
                </THead>
                <tbody>
                  {memberIds.map((uid) => {
                    const open = openMap.get(uid);
                    return (
                      <Tr key={uid}>
                        <Td>
                          <span className="block truncate font-semibold">{people.get(uid)?.name ?? "Unknown"}</span>
                          <span className="block text-xs text-muted">{roleOf.get(uid) ?? "Not on the team"}</span>
                        </Td>
                        <Td align="right">{open?.open ?? 0}</Td>
                        <Td align="right">{hoursLabel(open?.estimate ?? 0)} h</Td>
                        <Td align="right">{formatHours(loggedMap.get(uid) ?? 0)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Card>
        )}
      </div>

      {!caps.restricted && (
        <Card>
          <CardHeader title="Estimated vs actual effort" subtitle="Bar = hours logged · tick = estimate" />
          <CardBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-semibold">Whole project</span>
                <span className={cn("font-semibold tabular", estimate > 0 && totalHours > estimate ? "text-danger" : "text-ink-2")}>
                  {hoursLabel(Math.round(totalHours * 10) / 10)} h of {estimate > 0 ? `${hoursLabel(estimate)} h` : "no estimate"}
                </span>
              </div>
              <EffortBar actualHours={totalHours} estimateHours={estimate} className="h-2.5" />
            </div>
            {loggedByTask.length > 0 && (
              <div className="grid gap-x-8 gap-y-3 border-t border-line-soft pt-4 sm:grid-cols-2">
                {loggedByTask.map((r) => {
                  const t = perTask.get(r._id.toString());
                  if (!t) return null;
                  const actual = r.minutes / 60;
                  return (
                    <div key={r._id.toString()} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-3 text-[13px]">
                        <Link href={`/tasks/${t._id}`} className="min-w-0 font-medium break-words hover:text-brand-600">
                          <span className="mr-1.5 font-mono text-[11px] text-muted">{t.taskNo}</span>
                          {t.title}
                        </Link>
                        <span className={cn("shrink-0 text-xs font-semibold tabular", t.estimateHours > 0 && actual > t.estimateHours ? "text-danger" : "text-ink-2")}>
                          {hoursLabel(Math.round(actual * 10) / 10)} / {t.estimateHours > 0 ? hoursLabel(t.estimateHours) : "—"} h
                        </span>
                      </div>
                      <EffortBar actualHours={actual} estimateHours={t.estimateHours} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {billing && (
        <Card>
          <CardHeader title="Budget & billing" subtitle="Visible to users with project financials access" />
          <CardBody className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Budget", project.budget],
                ["Invoiced", billing.invoiced],
                ["Received", billing.received],
                ["Outstanding", Math.max(0, billing.invoiced - billing.received)],
                ["Expenses", billing.expenses],
                ["Remaining to invoice", Math.max(0, project.budget - billing.invoiced)],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl bg-field px-3 py-2.5">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 font-display text-base font-semibold text-ink tabular">{inr(value as number)}</dd>
                </div>
              ))}
            </dl>
            {milestones.some((m) => m.amount) && (
              <ul className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
                {milestones
                  .filter((m) => m.amount)
                  .map((m) => {
                    const inv = m.invoice ? billing.invoices.get(m.invoice.toString()) : undefined;
                    return (
                      <li key={m._id.toString()} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                        <span>
                          <span className="block font-semibold">{m.title}</span>
                          <span className="block text-xs text-muted">{inv ? inv.number : m.invoiced ? "Invoiced" : "Bill on milestone"}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold tabular">{inr(m.amount)}</span>
                          {inv ? <StatusChip domain="invoice" value={inv.status} size="sm" /> : <Chip tone="gray" size="sm">Not invoiced</Chip>}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
