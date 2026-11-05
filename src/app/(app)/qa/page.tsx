import Link from "next/link";
import { Plus } from "lucide-react";
import { and, asc, count, desc, eq, gt, gte, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { can, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ISSUE_STATUSES, Issue, Project, Task, type Id, type IssueSeverity } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, sortParam, withParams, type SearchParams, type SortChoices } from "@/lib/query";
import { inList, nocase, notInList, searchAny } from "@/lib/sql";
import { statusLabel } from "@/lib/status";
import { addDays, dateKey, diffDays, fmtDate, startOfDay, todayKey, weekStart } from "@/lib/time";
import { ISSUE_RESOLVED_STATUSES, issueFilter, myProjectIds, peopleMap, projectFilter, type Filter } from "@/lib/work-access";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/chip";
import { GroupedBarChart } from "@/components/ui/charts";
import { ChipFilters, ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter, SortSelect } from "@/components/ui/filters";
import { PageBody, PageHeader, StatCard } from "@/components/ui/page";
import { EmptyRow, TableWrap, THead, Th, Td, Tr } from "@/components/ui/table";
import { Segmented } from "@/components/ui/tabs";
import { SEVERITY_OPTIONS } from "../tasks/_components/options";
import { SeverityLabel } from "./_components/severity";

export const metadata = { title: "QA & issues" };

/** Statuses where the assignee still has work to do (target dates only matter here). */
const WORKING = ["open", "assigned", "in_progress", "reopened"];
const TREND_WEEKS = 8;

const SORTS = {
  severity: {
    label: "Severity (open first)",
    order: [
      asc(sql`case when ${inList(Issue.status, ISSUE_RESOLVED_STATUSES)} then 1 else 0 end`),
      asc(sql`case ${Issue.severity} when 'critical' then 0 when 'major' then 1 when 'minor' then 2 when 'trivial' then 3 else -1 end`),
      asc(sql`coalesce(${Issue.targetDate}, '9999-12-31')`),
      desc(Issue.createdAt),
    ],
  },
  newest: { label: "Newest first", order: [desc(Issue.createdAt)] },
  oldest: { label: "Oldest first", order: [asc(Issue.createdAt)] },
  target: { label: "Target date (soonest)", order: [asc(sql`coalesce(${Issue.targetDate}, '9999-12-31')`), desc(Issue.createdAt)] },
  title: { label: "Title A–Z", order: [asc(nocase(Issue.title)), desc(Issue.createdAt)] },
  updated: { label: "Recently updated", order: [desc(Issue.updatedAt)] },
} satisfies SortChoices<SQL[]>;

export default async function QaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const sort = sortParam(sp, SORTS);
  const today = todayKey();
  const currentWeek = weekStart(today);

  const visible = await issueFilter(user);
  const projectId = idParam(sp, "project");
  const assigneeId = idParam(sp, "assignee");
  const severity = param(sp, "severity");
  const status = param(sp, "status");
  const mine = param(sp, "scope") === "mine";

  const scoped: Filter[] = [visible];
  if (projectId) scoped.push(eq(Issue.project, projectId));
  const conds: Filter[] = [...scoped];
  if (mine) conds.push(or(eq(Issue.assignee, user._id), eq(Issue.reporter, user._id)));
  if (assigneeId) conds.push(eq(Issue.assignee, assigneeId));
  if (SEVERITY_OPTIONS.some((s) => s.value === severity)) conds.push(eq(Issue.severity, severity as IssueSeverity));
  if ((ISSUE_STATUSES as string[]).includes(status)) conds.push(eq(Issue.status, status as (typeof ISSUE_STATUSES)[number]));
  conds.push(searchAny(param(sp, "q"), Issue.title, Issue.issueNo));
  const filter: Filter = and(...conds);
  const base: Filter = and(...scoped);
  const isManager = can(user, "qa.view_all") || can(user, "qa.manage");
  // The user's own projects are needed for the "Report issue" rule and the project filter; load them once, on demand.
  let ownProjectIds: Id[] | undefined;
  const ownIds = async () => (ownProjectIds ??= await myProjectIds(user));
  // Same rule as /qa/new: QA managers, or anyone who manages / belongs to a project.
  const canReport = can(user, "qa.manage") || (await ownIds()).length > 0;

  const trendStart = addDays(currentWeek, -7 * (TREND_WEEKS - 1));
  const page = pageParam(sp);
  const unresolved = and(...scoped, notInList(Issue.status, ISSUE_RESOLVED_STATUSES));
  const [statusCounts, openCount, criticalCount, fixedThisWeek, everFixed, reopened, rows, total, trendIssues, projectDocs, people] = await Promise.all([
    db().select({ status: Issue.status, n: count() }).from(Issue).where(base).groupBy(Issue.status),
    db().$count(Issue, unresolved),
    db().$count(Issue, and(unresolved, eq(Issue.severity, "critical"))),
    db().$count(Issue, and(...scoped, gte(Issue.resolvedAt, startOfDay(currentWeek)))),
    db().$count(Issue, and(...scoped, or(isNotNull(Issue.resolvedAt), gt(Issue.reopenCount, 0), inList(Issue.status, ISSUE_RESOLVED_STATUSES)))),
    db().$count(Issue, and(...scoped, gt(Issue.reopenCount, 0))),
    db()
      .select({ _id: Issue._id, issueNo: Issue.issueNo, title: Issue.title, task: Issue.task, severity: Issue.severity, assignee: Issue.assignee, targetDate: Issue.targetDate, status: Issue.status, project: Issue.project })
      .from(Issue)
      .where(filter)
      .orderBy(...sort.order)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db().$count(Issue, filter),
    isManager
      ? db()
          .select({ reportedDate: Issue.reportedDate, closedAt: Issue.closedAt })
          .from(Issue)
          .where(and(...scoped, or(gte(Issue.reportedDate, trendStart), gte(Issue.closedAt, startOfDay(trendStart)))))
          .limit(5000)
      : [],
    db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title })
      .from(Project)
      .where(can(user, "qa.view_all") ? projectFilter(user) : inList(Project._id, await ownIds()))
      .orderBy(desc(Project.projectNo))
      .limit(300),
    peopleOptions(),
  ]);

  const [taskDocs, assignees] = await Promise.all([
    rows.some((r) => r.task) ? db().select({ _id: Task._id, taskNo: Task.taskNo }).from(Task).where(inList(Task._id, rows.flatMap((r) => (r.task ? [r.task] : [])))) : [],
    peopleMap(rows.map((r) => r.assignee)),
  ]);
  const taskNo = new Map(taskDocs.map((t) => [t._id, t.taskNo]));
  const projectNo = new Map(projectDocs.map((p) => [p._id, p.projectNo]));

  const counts = new Map(statusCounts.map((c) => [c.status, c.n]));
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
            <SelectFilter param="project" allLabel="All projects" label="Project" options={projectDocs.map((p) => ({ value: p._id, label: `${p.projectNo} · ${p.title}` }))} className="w-44" />
            <SelectFilter param="severity" allLabel="Any severity" label="Severity" options={SEVERITY_OPTIONS} />
            <SelectFilter param="assignee" allLabel="Any assignee" label="Assignee" options={people.map((p) => ({ value: p.id, label: p.name }))} className="w-40" />
            <SortSelect options={sort.options} />
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
                <Tr key={r._id} href={`/qa/${r._id}`}>
                  <Td className="max-w-[420px]">
                    <Link href={`/qa/${r._id}`} className="block min-w-0 hover:text-brand-600">
                      <span className="block truncate font-semibold">{r.title}</span>
                      <span className="block truncate text-xs text-muted">
                        {r.issueNo}
                        {projectNo.get(r.project) ? ` · ${projectNo.get(r.project)}` : ""}
                        {r.task && taskNo.get(r.task) ? ` · ${taskNo.get(r.task)}` : ""}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <SeverityLabel value={r.severity} />
                  </Td>
                  <Td className="text-ink-2">{r.assignee ? (assignees.get(r.assignee)?.name ?? "Unknown") : <span className="text-muted">Unassigned</span>}</Td>
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
