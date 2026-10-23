import { Plus } from "lucide-react";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { can, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Project } from "@/lib/models";
import { pageParam, PAGE_SIZE, param, withParams, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { notInList, searchAny } from "@/lib/sql";
import { keysInCategories, PROJECT_CLOSED_CATEGORIES, projectFilter, type Filter } from "@/lib/work-access";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipFilters, FilterBar, Pagination, SearchInput } from "@/components/ui/filters";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { PROJECT_ROW_FIELDS, buildProjectRows } from "./rows";
import { ProjectBoard, ProjectTable, ProjectTimeline, type ProjectColumn } from "./project-ui";

export const metadata = { title: "Projects" };

const BOARD_COLUMN_LIMIT = 30;
const TIMELINE_LIMIT = 60;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const settings = await getSettings();
  const statuses = settings.projectStatuses;
  const closedKeys = keysInCategories(statuses, PROJECT_CLOSED_CATEGORIES);

  const view = ["board", "timeline"].includes(param(sp, "view")) ? param(sp, "view") : "list";
  const visible = projectFilter(user);
  const statusParam = param(sp, "status");

  const base: Filter = and(visible, searchAny(param(sp, "q"), Project.title, Project.projectNo));
  const statusFilter: Filter =
    statusParam === "all" ? undefined : statuses.some((s) => s.key === statusParam) ? eq(Project.status, statusParam) : notInList(Project.status, closedKeys);
  const filter: Filter = and(base, statusFilter);

  const counts = await db().select({ status: Project.status, n: count() }).from(Project).where(visible).groupBy(Project.status);
  const countOf = new Map(counts.map((c) => [c.status, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const activeCount = counts.filter((c) => !closedKeys.includes(c.status)).reduce((s, c) => s + c.n, 0);

  let body;
  if (view === "list") {
    const page = pageParam(sp);
    const [projects, matching] = await Promise.all([
      db().select(PROJECT_ROW_FIELDS).from(Project).where(filter).orderBy(desc(Project.projectNo)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
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
    const shown = statusParam === "all" ? statuses : statuses.filter((s) => (statuses.some((x) => x.key === statusParam) ? s.key === statusParam : !closedKeys.includes(s.key)));
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
    { value: "", label: "Active", count: activeCount },
    { value: "all", label: "All", count: total },
    ...statuses.filter((s) => (countOf.get(s.key) ?? 0) > 0 || s.key === statusParam).map((s) => ({ value: s.key, label: s.label, count: countOf.get(s.key) ?? 0 })),
  ];

  return (
    <PageBody>
      <PageHeader
        overline="Work"
        title="Projects"
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
      </FilterBar>
      {body}
    </PageBody>
  );
}
