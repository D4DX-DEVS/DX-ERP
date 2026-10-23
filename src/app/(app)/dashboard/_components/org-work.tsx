import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Lead, Project, Task } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { hiddenClientIds, oid } from "@/lib/reports/shared";
import { diffDays, fmtDate } from "@/lib/time";
import { inrCompact } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { HBarList } from "@/components/ui/charts";
import { EmptyState, MiniStat, Progress } from "@/components/ui/page";
import { getPeriods } from "../_lib/queries";
import { ListRow } from "./shared";

export async function ProjectsCard() {
  await connectDB();
  const settings = await getSettings();
  const { today, fy } = getPeriods();
  const keysIn = (...cats: string[]) => settings.projectStatuses.filter((s) => cats.includes(s.category)).map((s) => s.key);
  const openKeys = keysIn("enquiry", "planning", "active", "hold", "review");
  const completedKeys = keysIn("completed");
  const categoryOf = (key: string) => settings.projectStatuses.find((s) => s.key === key)?.category;

  const projects = await Project.find(
    { $or: [{ status: { $in: openKeys } }, { status: { $in: completedKeys }, completedDate: { $gte: fy.from } }] },
    { projectNo: 1, title: 1, status: 1, startDate: 1, targetDate: 1, completedDate: 1, milestones: 1 },
  ).lean();

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
    if (days > 0 && category !== "enquiry") delayed.push({ id: p._id.toString(), projectNo: p.projectNo, title: p.title, days, reason: late >= overdueMilestone ? "past target date" : "milestone overdue" });
  }
  delayed.sort((a, b) => b.days - a.days);
  const atRisk = delayed.slice(0, 3);

  const progress = atRisk.length
    ? await Task.aggregate<{ _id: unknown; avg: number }>([
        { $match: { project: { $in: atRisk.map((p) => oid(p.id)) }, status: { $nin: settings.taskStatuses.filter((s) => s.category === "cancelled").map((s) => s.key) } } },
        { $group: { _id: "$project", avg: { $avg: { $cond: [{ $in: ["$status", settings.taskStatuses.filter((s) => s.category === "done").map((s) => s.key)] }, 100, "$progress"] } } } },
      ])
    : [];
  const progressOf = new Map(progress.map((p) => [String(p._id), Math.round(p.avg)]));

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
  await connectDB();
  const settings = await getSettings();
  const hidden = await hiddenClientIds(user);
  const leadScope = hidden.length ? { client: { $nin: hidden } } : {};
  const [activeClients, stages] = await Promise.all([
    Client.countDocuments({ status: "active", ...(hidden.length ? { _id: { $nin: hidden } } : {}) }),
    Lead.aggregate<{ _id: string; count: number; value: number }>([
      { $match: { status: "open", ...leadScope } },
      { $group: { _id: "$stage", count: { $sum: 1 }, value: { $sum: { $ifNull: ["$expectedValue", { $ifNull: ["$budget", 0] }] } } } },
    ]),
  ]);
  const openLeads = stages.reduce((s, r) => s + r.count, 0);
  const pipeline = stages.reduce((s, r) => s + r.value, 0);
  const funnel = settings.pipelineStages
    .filter((s) => s.category === "open")
    .map((s) => ({ stage: s, row: stages.find((r) => r._id === s.key) }))
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
  await connectDB();
  const settings = await getSettings();
  const { today } = getPeriods();
  const closed = settings.taskStatuses.filter((s) => s.category === "done" || s.category === "cancelled").map((s) => s.key);
  const match = { status: { $nin: closed }, dueDate: { $lt: today } };
  const [groups, oldest] = await Promise.all([
    Task.aggregate<{ _id: unknown; n: number }>([{ $match: match }, { $group: { _id: "$project", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Task.findOne(match, { taskNo: 1, title: 1, dueDate: 1 }).sort({ dueDate: 1 }).lean(),
  ]);
  const total = groups.reduce((s, g) => s + g.n, 0);
  const top = groups.slice(0, 5);
  const projectIds = top.map((g) => g._id).filter(Boolean) as string[];
  const projects = projectIds.length ? await Project.find({ _id: { $in: projectIds } }, { title: 1 }).lean() : [];
  const title = new Map(projects.map((p) => [p._id.toString(), p.title]));

  return (
    <Card className="h-full">
      <CardHeader title="Overdue tasks" href="/tasks?scope=all" hrefLabel="Task board" />
      <CardBody className="flex flex-col gap-4">
        <div>
          <div className={`font-display text-[28px] leading-none font-semibold tabular ${total > 0 ? "text-danger" : "text-ink"}`}>{total}</div>
          <div className="mt-1.5 text-xs text-muted">{total === 0 ? "Nothing is past its deadline" : `past deadline across ${groups.length} project${groups.length === 1 ? "" : "s"}`}</div>
        </div>
        {top.length > 0 && <HBarList color="#B42323" rows={top.map((g) => ({ label: g._id ? (title.get(String(g._id)) ?? "Unknown project") : "No project", value: g.n }))} />}
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
