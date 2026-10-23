import Link from "next/link";
import { Plus } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { ISSUE_STATUSES, Issue, Project, Task, Types, type IIssue } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, searchRegex, withParams, type SearchParams } from "@/lib/query";
import { statusLabel } from "@/lib/status";
import { addDays, dateKey, diffDays, fmtDate, startOfDay, todayKey, weekStart } from "@/lib/time";
import { ISSUE_RESOLVED_STATUSES, issueFilter, myProjectIds, peopleMap, projectFilter, type Filter } from "@/lib/work-access";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { GroupedBarChart } from "@/components/ui/charts";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { Segmented } from "@/components/ui/tabs";
import { SEVERITY_OPTIONS } from "../tasks/_components/options";
import { SeverityLabel } from "./_components/severity";

export const metadata = { title: "QA & issues" };

/** Statuses where the assignee still has work to do (target dates only matter here). */
const WORKING = ["open", "assigned", "in_progress", "reopened"];
const TREND_WEEKS = 8;

type Row = Pick<IIssue, "_id" | "issueNo" | "title" | "task" | "severity" | "assignee" | "targetDate" | "status" | "project">;

export default async function QaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await connectDB();
  const today = todayKey();
  const currentWeek = weekStart(today);

  const visible = await issueFilter(user);
  const projectId = idParam(sp, "project");
  const assigneeId = idParam(sp, "assignee");
  const severity = param(sp, "severity");
  const status = param(sp, "status");
  const mine = param(sp, "scope") === "mine";
  const rx = searchRegex(param(sp, "q"));

  const scoped: Filter[] = [visible];
  if (projectId) scoped.push({ project: new Types.ObjectId(projectId) });
  const and: Filter[] = [...scoped];
  if (mine) and.push({ $or: [{ assignee: user._id }, { reporter: user._id }] });
  if (assigneeId) and.push({ assignee: new Types.ObjectId(assigneeId) });
  if (SEVERITY_OPTIONS.some((s) => s.value === severity)) and.push({ severity });
  if ((ISSUE_STATUSES as string[]).includes(status)) and.push({ status });
  if (rx) and.push({ $or: [{ title: rx }, { issueNo: rx }] });
  const filter: Filter = { $and: and };
  const base: Filter = { $and: scoped };
  const isManager = can(user, "qa.view_all") || can(user, "qa.manage");
  // Same rule as /qa/new: QA managers, or anyone who manages / belongs to a project.
  const canReport = can(user, "qa.manage") || (await myProjectIds(user)).length > 0;

  const trendStart = addDays(currentWeek, -7 * (TREND_WEEKS - 1));
  const page = pageParam(sp);
  const [statusCounts, openCount, criticalCount, fixedThisWeek, everFixed, reopened, rows, total, trendIssues, projectDocs, people] = await Promise.all([
    Issue.aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    Issue.countDocuments({ $and: [...scoped, { status: { $nin: ISSUE_RESOLVED_STATUSES } }] }),
    Issue.countDocuments({ $and: [...scoped, { status: { $nin: ISSUE_RESOLVED_STATUSES }, severity: "critical" }] }),
    Issue.countDocuments({ $and: [...scoped, { resolvedAt: { $gte: startOfDay(currentWeek) } }] }),
    Issue.countDocuments({ $and: [...scoped, { $or: [{ resolvedAt: { $ne: null } }, { reopenCount: { $gt: 0 } }, { status: { $in: ISSUE_RESOLVED_STATUSES } }] }] }),
    Issue.countDocuments({ $and: [...scoped, { reopenCount: { $gt: 0 } }] }),
    Issue.aggregate<Row>([
      { $match: filter },
      {
        $addFields: {
          _closed: { $in: ["$status", ISSUE_RESOLVED_STATUSES] },
          _rank: { $indexOfArray: [["critical", "major", "minor", "trivial"], "$severity"] },
          _due: { $ifNull: ["$targetDate", "9999-12-31"] },
        },
      },
      { $sort: { _closed: 1, _rank: 1, _due: 1, createdAt: -1 } },
      { $skip: (page - 1) * PAGE_SIZE },
      { $limit: PAGE_SIZE },
      { $project: { issueNo: 1, title: 1, task: 1, severity: 1, assignee: 1, targetDate: 1, status: 1, project: 1 } },
    ]),
    Issue.countDocuments(filter),
    isManager
      ? Issue.find({ $and: [...scoped, { $or: [{ reportedDate: { $gte: trendStart } }, { closedAt: { $gte: startOfDay(trendStart) } }] }] }, { reportedDate: 1, closedAt: 1 }).limit(5000).lean()
      : [],
    Project.find(can(user, "qa.view_all") ? projectFilter(user) : { _id: { $in: await myProjectIds(user) } }, { projectNo: 1, title: 1 }).sort({ projectNo: -1 }).limit(300).lean(),
    peopleOptions(),
  ]);

  const [taskDocs, assignees] = await Promise.all([
    rows.some((r) => r.task) ? Task.find({ _id: { $in: rows.flatMap((r) => (r.task ? [r.task] : [])) } }, { taskNo: 1 }).lean() : [],
    peopleMap(rows.map((r) => r.assignee)),
  ]);
  const taskNo = new Map(taskDocs.map((t) => [t._id.toString(), t.taskNo]));
  const projectNo = new Map(projectDocs.map((p) => [p._id.toString(), p.projectNo]));

  const counts = new Map(statusCounts.map((c) => [c._id, c.n]));
  const totalIssues = [...counts.values()].reduce((s, n) => s + n, 0);
  const reopenRate = everFixed > 0 ? Math.round((reopened / everFixed) * 100) : 0;
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => addDays(trendStart, 7 * i));
  const trend = weeks.map((w) => ({
    label: fmtDate(w, "d MMM"),
    opened: trendIssues.filter((i) => weekStart(i.reportedDate) === w).length,
    closed: trendIssues.filter((i) => i.closedAt && weekStart(dateKey(i.closedAt)) === w).length,
  }));

  const link = (updates: Record<string, string | null>) => withParams("/qa", sp, updates);

  return (
    <PageBody>
      <PageHeader
        overline="Work"
        title="QA & issues"
        actions={
          canReport ? (
            <ButtonLink href={projectId ? `/qa/new?project=${projectId}` : "/qa/new"} icon={<Plus className="size-4" aria-hidden />}>
              Report issue
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open issues" value={openCount} sub="Not yet verified" />
        <StatCard label="Critical open" value={criticalCount} tone={criticalCount > 0 ? "alert" : "default"} sub="Need immediate attention" />
        <StatCard label="Fixed this week" value={fixedThisWeek} sub={`Since ${fmtDate(currentWeek, "EEE d MMM")}`} />
        <StatCard label="Reopen rate" value={`${reopenRate}%`} sub={`${reopened} of ${everFixed} fixed issues reopened`} />
      </div>

      {isManager && (
        <Card>
          <CardHeader title="Opened vs closed" subtitle={`Issues reported and closed per week, last ${TREND_WEEKS} weeks`} />
          <CardBody>
            <GroupedBarChart
              data={trend}
              height={220}
              format="number"
              series={[
                { key: "opened", label: "Opened", color: "#D0691F" },
                { key: "closed", label: "Closed", color: "#0E9F75" },
              ]}
            />
          </CardBody>
        </Card>
      )}

      <ChipFilters
        param="status"
        options={[
          { value: "", label: "All", count: totalIssues },
          ...ISSUE_STATUSES.filter((s) => (counts.get(s) ?? 0) > 0 || s === status).map((s) => ({ value: s, label: statusLabel("issue", s), count: counts.get(s) ?? 0 })),
        ]}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3">
          <Segmented
            items={[
              { href: link({ scope: null }), label: "All issues", active: !mine },
              { href: link({ scope: "mine" }), label: "Mine", active: mine },
            ]}
          />
          <FilterBar className="flex-1">
            <SearchInput placeholder="Search issues" className="sm:w-56" />
            <SelectFilter param="project" allLabel="All projects" label="Project" options={projectDocs.map((p) => ({ value: p._id.toString(), label: `${p.projectNo} · ${p.title}` }))} className="w-44" />
            <SelectFilter param="severity" allLabel="Any severity" label="Severity" options={SEVERITY_OPTIONS} />
            <SelectFilter param="assignee" allLabel="Any assignee" label="Assignee" options={people.map((p) => ({ value: p.id, label: p.name }))} className="w-40" />
            <ClearFilters />
          </FilterBar>
        </div>
        <TableWrap phone={[1, 5]} tablet={[1, 2, 3, 5]}>
          <THead>
            <Th>Issue</Th>
            <Th>Severity</Th>
            <Th>Assignee</Th>
            <Th>Target</Th>
            <Th>Status</Th>
          </THead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>{totalIssues === 0 ? "No issues have been reported yet." : "No issues match these filters."}</EmptyRow>}
            {rows.map((r) => {
              const late = r.targetDate && r.targetDate < today && WORKING.includes(r.status);
              return (
                <Tr key={r._id.toString()}>
                  <Td className="max-w-[420px]">
                    <Link href={`/qa/${r._id}`} className="block min-w-0 hover:text-brand-600">
                      <span className="block truncate font-semibold">{r.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {r.issueNo}
                        {projectNo.get(r.project.toString()) ? ` · ${projectNo.get(r.project.toString())}` : ""}
                        {r.task && taskNo.get(r.task.toString()) ? ` · ${taskNo.get(r.task.toString())}` : ""}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <SeverityLabel value={r.severity} />
                  </Td>
                  <Td className="text-ink-2">{r.assignee ? (assignees.get(r.assignee.toString())?.name ?? "Unknown") : <span className="text-muted">Unassigned</span>}</Td>
                  <Td className="whitespace-nowrap">
                    {r.targetDate ? <span className={cn(late ? "font-semibold text-danger" : "text-ink-2")}>{late ? `${diffDays(r.targetDate, today)}d late` : fmtDate(r.targetDate, "EEE d MMM")}</span> : <span className="text-muted">—</span>}
                  </Td>
                  <Td>
                    <StatusChip domain="issue" value={r.status} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    </PageBody>
  );
}
