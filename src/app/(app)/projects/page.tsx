import { Plus } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Project } from "@/lib/models";
import { pageParam, PAGE_SIZE, param, searchRegex, withParams, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
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
  await connectDB();
  const settings = await getSettings();
  const statuses = settings.projectStatuses;
  const closedKeys = keysInCategories(statuses, PROJECT_CLOSED_CATEGORIES);

  const view = ["board", "timeline"].includes(param(sp, "view")) ? param(sp, "view") : "list";
  const visible = projectFilter(user);
  const statusParam = param(sp, "status");
  const rx = searchRegex(param(sp, "q"));

  const base: Filter[] = [visible];
  if (rx) base.push({ $or: [{ title: rx }, { projectNo: rx }] });
  const statusFilter: Filter =
    statusParam === "all" ? {} : statuses.some((s) => s.key === statusParam) ? { status: statusParam } : { status: { $nin: closedKeys } };
  const filter: Filter = { $and: [...base, statusFilter] };

  const counts = await Project.aggregate<{ _id: string; n: number }>([{ $match: visible }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  const countOf = new Map(counts.map((c) => [c._id, c.n]));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const activeCount = counts.filter((c) => !closedKeys.includes(c._id)).reduce((s, c) => s + c.n, 0);

  let body;
  if (view === "list") {
    const page = pageParam(sp);
    const [projects, matching] = await Promise.all([
      Project.find(filter, PROJECT_ROW_FIELDS).sort({ projectNo: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
      Project.countDocuments(filter),
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
    const columns: ProjectColumn[] = await Promise.all(
      shown.map(async (s) => {
        const colFilter: Filter = { $and: [...base, { status: s.key }] };
        const [projects, colTotal] = await Promise.all([
          Project.find(colFilter, PROJECT_ROW_FIELDS).sort({ updatedAt: -1 }).limit(BOARD_COLUMN_LIMIT).lean(),
          Project.countDocuments(colFilter),
        ]);
        return { status: s, rows: await buildProjectRows(user, projects, settings), total: colTotal };
      }),
    );
    body = <ProjectBoard columns={columns} />;
  } else {
    const projects = await Project.find(filter, PROJECT_ROW_FIELDS).sort({ startDate: 1, projectNo: -1 }).limit(TIMELINE_LIMIT).lean();
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
