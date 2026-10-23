import Link from "next/link";
import { and, asc, count, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Lead, Project, Task } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { hiddenClientIds } from "@/lib/reports/shared";
import { inList, notInList } from "@/lib/sql";
import { diffDays, fmtDate } from "@/lib/time";
import { inrCompact } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { HBarList } from "@/components/ui/charts";
import { EmptyState, MiniStat, Progress } from "@/components/ui/page";
import { getPeriods } from "../_lib/queries";
import { ListRow } from "./shared";

export async function ProjectsCard() {
  const settings = await getSettings();
  const { today, fy } = getPeriods();
  const keysIn = (...cats: string[]) => settings.projectStatuses.filter((s) => cats.includes(s.category)).map((s) => s.key);
  const openKeys = keysIn("enquiry", "planning", "active", "hold", "review");
  const completedKeys = keysIn("completed");
  const categoryOf = (key: string) => settings.projectStatuses.find((s) => s.key === key)?.category;

  const projects = await db()
    .select({
      _id: Project._id,
      projectNo: Project.projectNo,
      title: Project.title,
      status: Project.status,
      startDate: Project.startDate,
      targetDate: Project.targetDate,
      completedDate: Project.completedDate,
      milestones: Project.milestones,
    })
    .from(Project)
    .where(or(inList(Project.status, openKeys), and(inList(Project.status, completedKeys), gte(Project.completedDate, fy.from))));

  let active = 0;
  let upcoming = 0;
  let done = 0;
  const delayed: { id: string; projectNo: string; title: string; days: number; reason: string }[] = [];
  for (const p of projects) {
    const category = categoryOf(p.status);
    if (category === "completed") {
      done += 1;
      continue;
    }
    if (category === "active" || category === "review") active += 1;
    if (category === "enquiry" || category === "planning" || (p.startDate && p.startDate > today)) upcoming += 1;
    const late = p.targetDate && p.targetDate < today ? diffDays(p.targetDate, today) : 0;
    const overdueMilestone = p.milestones
      .filter((m) => m.status !== "delivered" && m.status !== "approved" && !m.deliveredAt && m.dueDate && m.dueDate < today)
      .reduce((max, m) => Math.max(max, diffDays(m.dueDate as string, today)), 0);
    const days = Math.max(late, overdueMilestone);
    if (days > 0 && category !== "enquiry") delayed.push({ id: p._id, projectNo: p.projectNo, title: p.title, days, reason: late >= overdueMilestone ? "past target date" : "milestone overdue" });
  }
  delayed.sort((a, b) => b.days - a.days);
  const atRisk = delayed.slice(0, 3);

  const progress = atRisk.length
    ? await db()
        .select({
          project: Task.project,
          avg: sql<number>`avg(case when ${inList(Task.status, settings.taskStatuses.filter((s) => s.category === "done").map((s) => s.key))} then 100 else ${Task.progress} end)`.mapWith(Number),
        })
        .from(Task)
        .where(and(inList(Task.project, atRisk.map((p) => p.id)), notInList(Task.status, settings.taskStatuses.filter((s) => s.category === "cancelled").map((s) => s.key))))
        .groupBy(Task.project)
    : [];
  const progressOf = new Map(progress.map((p) => [String(p.project), Math.round(p.avg)]));

  return (
    <Card className="h-full">
      <CardHeader title="Projects" href="/projects" hrefLabel="All" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-4 gap-2">
          <MiniStat value={active} label="Active" />
          <MiniStat value={delayed.length} label="Delayed" className={delayed.length ? "[&>div:first-child]:text-danger" : undefined} />
          <MiniStat value={upcoming} label="Upcoming" />
          <MiniStat value={done} label="Done FY" />
        </div>
      </CardBody>
      {atRisk.length === 0 ? (
        <p className="border-t border-line-soft px-5 py-4 text-[13px] text-muted">{projects.length === 0 ? "No projects yet." : "No project is behind schedule."}</p>
      ) : (
        <div>
          {atRisk.map((p) => {
            const pct = progressOf.get(p.id);
            return (
              <ListRow
                key={p.id}
                href={`/projects/${p.id}`}
                title={p.title}
                meta={`${p.days} day${p.days === 1 ? "" : "s"} late · ${p.reason}${pct !== undefined ? ` · ${pct}% done` : ""}`}
                trailing={pct !== undefined ? <Progress value={pct} tone="red" className="w-14" size="sm" /> : undefined}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

export async function PipelineCard({ user }: { user: CurrentUser }) {
  const settings = await getSettings();
  const hidden = await hiddenClientIds(user);
  const [activeClients, stages] = await Promise.all([
    db().$count(Client, and(eq(Client.status, "active"), hidden.length ? notInList(Client._id, hidden) : undefined)),
    db()
      .select({ stage: Lead.stage, count: count(), value: sql<number>`coalesce(sum(coalesce(${Lead.expectedValue}, ${Lead.budget}, 0)), 0)`.mapWith(Number) })
      .from(Lead)
      .where(and(eq(Lead.status, "open"), hidden.length ? notInList(Lead.client, hidden) : undefined))
      .groupBy(Lead.stage),
  ]);
  const openLeads = stages.reduce((s, r) => s + r.count, 0);
  const pipeline = stages.reduce((s, r) => s + r.value, 0);
  const funnel = settings.pipelineStages
    .filter((s) => s.category === "open")
    .map((s) => ({ stage: s, row: stages.find((r) => r.stage === s.key) }))
    .filter((x) => x.row)
    .map((x) => ({ label: x.stage.label, value: x.row?.value ?? 0, hint: `${x.stage.label}: ${x.row?.count ?? 0} open, ${inrCompact(x.row?.value ?? 0)}` }));

  return (
    <Card className="h-full">
      <CardHeader title="Clients & pipeline" href="/crm" hrefLabel="Pipeline" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <MiniStat value={activeClients} label="Active clients" />
          <MiniStat value={openLeads} label="Open enquiries" />
          <MiniStat value={inrCompact(pipeline)} label="Open pipeline" />
        </div>
        {funnel.length === 0 ? <p className="text-[13px] text-muted">No open enquiries in the pipeline.</p> : <HBarList rows={funnel} format="inrCompact" />}
      </CardBody>
    </Card>
  );
}

export async function OverdueTasksCard() {
  const settings = await getSettings();
  const { today } = getPeriods();
  const closed = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);
  const match = and(notInList(Task.status, closed), lt(Task.dueDate, today));
  const n = count();
  const [groups, [oldest]] = await Promise.all([
    // Project titles come with the groups (join), so the card needs no second lookup.
    db()
      .select({ project: Task.project, title: Project.title, n })
      .from(Task)
      .leftJoin(Project, eq(Project._id, Task.project))
      .where(match)
      .groupBy(Task.project)
      .orderBy(desc(n)),
    db().select({ _id: Task._id, taskNo: Task.taskNo, title: Task.title, dueDate: Task.dueDate }).from(Task).where(match).orderBy(asc(Task.dueDate)).limit(1),
  ]);
  const total = groups.reduce((s, g) => s + g.n, 0);
  const top = groups.slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader title="Overdue tasks" href="/tasks?scope=all" hrefLabel="Task board" />
      <CardBody className="flex flex-col gap-4">
        <div>
          <div className={`font-display text-[28px] leading-none font-semibold tabular ${total > 0 ? "text-danger" : "text-ink"}`}>{total}</div>
          <div className="mt-1.5 text-xs text-muted">{total === 0 ? "Nothing is past its deadline" : `past deadline across ${groups.length} project${groups.length === 1 ? "" : "s"}`}</div>
        </div>
        {top.length > 0 && <HBarList color="#B42323" rows={top.map((g) => ({ label: g.project ? (g.title ?? "Unknown project") : "No project", value: g.n }))} />}
        {oldest?.dueDate && (
          <p className="border-t border-line-soft pt-3 text-xs text-muted">
            Oldest:{" "}
            <Link href={`/tasks/${oldest._id}`} className="font-semibold text-ink hover:text-brand-600">
              {oldest.taskNo} {oldest.title}
            </Link>{" "}
            · {diffDays(oldest.dueDate, today)} days overdue (due {fmtDate(oldest.dueDate)})
          </p>
        )}
        {total === 0 && <EmptyState title="All caught up" className="py-2" />}
      </CardBody>
    </Card>
  );
}
