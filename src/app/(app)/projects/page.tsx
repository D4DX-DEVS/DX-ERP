import { Plus } from "lucide-react";
import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { can, canAny, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Project } from "@/lib/models";
import { pageParam, PAGE_SIZE, param, sortParam, withParams, type SearchParams, type SortChoices } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { nocase, notInList, searchAny } from "@/lib/sql";
import { keysInCategories, PROJECT_CLOSED_CATEGORIES, projectFilter, type Filter } from "@/lib/work-access";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipFilters, FilterBar, Pagination, SearchInput, SortSelect } from "@/components/ui/filters";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { PROJECT_ROW_FIELDS, buildProjectRows } from "./rows";
import { ProjectBoard, ProjectTable, ProjectTimeline, type ProjectColumn } from "./project-ui";

export const metadata = { title: "Projects" };

const BOARD_COLUMN_LIMIT = 30;
const TIMELINE_LIMIT = 60;

const SORTS = {
  newest: { label: "Newest first", order: [desc(Project.projectNo)] },
  oldest: { label: "Oldest first", order: [asc(Project.projectNo)] },
  updated: { label: "Recently updated", order: [desc(Project.updatedAt)] },
  title: { label: "Title A–Z", order: [asc(nocase(Project.title)), desc(Project.projectNo)] },
  titleDesc: { label: "Title Z–A", order: [desc(nocase(Project.title)), desc(Project.projectNo)] },
  target: { label: "Target date (soonest)", order: [asc(sql`coalesce(${Project.targetDate}, '9999-12-31')`), desc(Project.projectNo)] },
} satisfies SortChoices<SQL[]>;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const sort = sortParam(sp, SORTS);
  const settings = await getSettings();
  const statuses = settings.projectStatuses;
  const closedKeys = keysInCategories(statuses, PROJECT_CLOSED_CATEGORIES);

  const view = ["board", "timeline"].includes(param(sp, "view")) ? param(sp, "view") : "list";
  const visible = projectFilter(user);
  const statusParam = param(sp, "status");

  const base: Filter = and(visible, searchAny(param(sp, "q"), Project.title, Project.projectNo));
  // Every project by default; "active" hides closed ones, a status key narrows to that status.
  const statusFilter: Filter =
    statusParam === "active" ? notInList(Project.status, closedKeys) : statuses.some((s) => s.key === statusParam) ? eq(Project.status, statusParam) : undefined;
  const filter: Filter = and(base, statusFilter);

  const counts = await db().select({ status: Project.status, n: count() }).from(Project).where(visible).groupBy(Project.status);
  const countOf = new Map(counts.map((c) => [c.status, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const activeCount = counts.filter((c) => !closedKeys.includes(c.status)).reduce((s, c) => s + c.n, 0);

  let body;
  if (view === "list") {
    const page = pageParam(sp);
    const [projects, matching] = await Promise.all([
      db().select(PROJECT_ROW_FIELDS).from(Project).where(filter).orderBy(...sort.order).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
      db().$count(Project, filter),
    ]);
    const rows = await buildProjectRows(user, projects, settings);
    body = (
      <Card>
        <ProjectTable rows={rows} statuses={statuses} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={matching} />
      </Card>
    );
  } else if (view === "board") {
    const shown = statuses.filter((s) => (statuses.some((x) => x.key === statusParam) ? s.key === statusParam : statusParam !== "active" || !closedKeys.includes(s.key)));
    // One query per column plus one grouped count; the rows of every column are built together.
    const [perStatus, totalRows] = await Promise.all([
      Promise.all(
        shown.map((s) =>
          db().select(PROJECT_ROW_FIELDS).from(Project).where(and(base, eq(Project.status, s.key))).orderBy(desc(Project.updatedAt)).limit(BOARD_COLUMN_LIMIT),
        ),
      ),
      db().select({ status: Project.status, n: count() }).from(Project).where(base).groupBy(Project.status),
    ]);
    const boardRows = await buildProjectRows(user, perStatus.flat(), settings);
    const totals = new Map(totalRows.map((r) => [r.status, r.n]));
    const columns: ProjectColumn[] = [];
    let offset = 0;
    for (let i = 0; i < shown.length; i++) {
      const size = perStatus[i].length;
      columns.push({ status: shown[i], rows: boardRows.slice(offset, offset + size), total: totals.get(shown[i].key) ?? 0 });
      offset += size;
    }
    body = <ProjectBoard columns={columns} />;
  } else {
    const projects = await db().select(PROJECT_ROW_FIELDS).from(Project).where(filter).orderBy(asc(Project.startDate), desc(Project.projectNo)).limit(TIMELINE_LIMIT);
    const rows = await buildProjectRows(user, projects, settings);
    body = (
      <Card>
        <ProjectTimeline rows={rows} statuses={statuses} />
      </Card>
    );
  }

  const link = (v: string | null) => withParams("/projects", sp, { view: v });
  const chipOptions = [
    { value: "", label: "All", count: total },
    { value: "active", label: "Active", count: activeCount },
    ...statuses.filter((s) => (countOf.get(s.key) ?? 0) > 0 || s.key === statusParam).map((s) => ({ value: s.key, label: s.label, count: countOf.get(s.key) ?? 0 })),
  ];

  return (
    <PageBody>
      <PageHeader
        overline="Work"
        title={canAny(user, ["projects.manage", "qa.projects"]) ? "Projects" : "My projects"}
        actions={
          <>
            <Segmented
              items={[
                { href: link(null), label: "List", active: view === "list" },
                { href: link("board"), label: "Board", active: view === "board" },
                { href: link("timeline"), label: "Timeline", active: view === "timeline" },
              ]}
            />
            {can(user, "projects.manage") && (
              <ButtonLink href="/projects/new" icon={<Plus className="size-4" aria-hidden />}>
                New project
              </ButtonLink>
            )}
          </>
        }
      />
      <ChipFilters param="status" options={chipOptions} />
      <FilterBar>
        <SearchInput placeholder="Search projects" />
        {view === "list" && <SortSelect options={sort.options} />}
      </FilterBar>
      {body}
    </PageBody>
  );
}
