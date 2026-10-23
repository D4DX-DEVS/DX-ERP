import { Plus } from "lucide-react";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { PRIORITIES, Project, Task, Types } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, searchRegex, withParams, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { addDays, todayKey, weekStart } from "@/lib/time";
import { keysInCategories, projectFilter, taskFilter, TASK_CLOSED_CATEGORIES, type Filter } from "@/lib/work-access";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { queryTasks } from "./_components/task-query";
import { toTaskRows } from "./_components/task-rows";
import { TaskBoard, TaskTable, type BoardColumn } from "./_components/task-ui";
import { PRIORITY_OPTIONS } from "./_components/options";

export const metadata = { title: "Tasks" };

const BOARD_COLUMN_LIMIT = 30;

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await connectDB();
  const settings = await getSettings();
  const statuses = settings.taskStatuses;
  const closedKeys = keysInCategories(statuses, TASK_CLOSED_CATEGORIES);
  const today = todayKey();

  const scope = param(sp, "scope") === "all" ? "all" : "mine";
  const view = param(sp, "view") === "board" ? "board" : "list";
  const visible = await taskFilter(user);

  const and: Filter[] = [visible];
  if (scope === "mine") and.push({ assignees: user._id });
  const projectId = idParam(sp, "project");
  if (projectId) and.push({ project: new Types.ObjectId(projectId) });
  const assigneeId = idParam(sp, "assignee");
  if (assigneeId) and.push({ assignees: new Types.ObjectId(assigneeId) });
  const priority = param(sp, "priority");
  if ((PRIORITIES as string[]).includes(priority)) and.push({ priority });
  const status = param(sp, "status");
  if (statuses.some((s) => s.key === status)) and.push({ status });
  const due = param(sp, "due");
  if (due === "overdue") and.push({ dueDate: { $lt: today }, status: { $nin: closedKeys } });
  if (due === "week") {
    const monday = weekStart(today);
    and.push({ dueDate: { $gte: monday, $lte: addDays(monday, 6) }, status: { $nin: closedKeys } });
  }
  const q = param(sp, "q");
  const rx = searchRegex(q);
  if (rx) and.push({ $or: [{ title: rx }, { taskNo: rx }] });
  const filter: Filter = { $and: and };

  const page = pageParam(sp);
  const sortedPage = (match: Filter, skip: number, limit: number) => queryTasks(match, closedKeys, skip, limit);

  const [projects, people, canCreateAny] = await Promise.all([
    Project.find(projectFilter(user), { projectNo: 1, title: 1 }).sort({ projectNo: -1 }).limit(300).lean(),
    peopleOptions(),
    can(user, "tasks.manage") ? Promise.resolve(true) : Project.exists({ manager: user._id }).then(Boolean),
  ]);

  let body;
  if (view === "list") {
    const [tasks, total] = await Promise.all([sortedPage(filter, (page - 1) * PAGE_SIZE, PAGE_SIZE), Task.countDocuments(filter)]);
    const rows = await toTaskRows(user, tasks, settings);
    body = (
      <Card>
        <TaskTable rows={rows} statuses={statuses} empty={scope === "mine" && !q ? "Nothing is assigned to you right now." : "No tasks match these filters."} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    );
  } else {
    const columns: BoardColumn[] = await Promise.all(
      statuses.map(async (s) => {
        const colFilter: Filter = { $and: [...and, { status: s.key }] };
        const [tasks, total] = await Promise.all([sortedPage(colFilter, 0, BOARD_COLUMN_LIMIT), Task.countDocuments(colFilter)]);
        return { status: s, rows: await toTaskRows(user, tasks, settings), total };
      }),
    );
    body = <TaskBoard columns={columns} statuses={statuses} />;
  }

  const link = (updates: Record<string, string | null>) => withParams("/tasks", sp, updates);

  return (
    <PageBody>
      <PageHeader
        overline="Work"
        title="Tasks"
        actions={
          canCreateAny && (
            <ButtonLink href="/tasks/new" icon={<Plus className="size-4" aria-hidden />}>
              New task
            </ButtonLink>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          items={[
            { href: link({ scope: null }), label: "Assigned to me", active: scope === "mine" },
            { href: link({ scope: "all" }), label: "All I can see", active: scope === "all" },
          ]}
        />
        <Segmented
          items={[
            { href: link({ view: null }), label: "List", active: view === "list" },
            { href: link({ view: "board" }), label: "Board", active: view === "board" },
          ]}
        />
      </div>
      <FilterBar>
        <SearchInput placeholder="Search tasks" />
        <SelectFilter param="project" allLabel="All projects" label="Project" options={projects.map((p) => ({ value: p._id.toString(), label: `${p.projectNo} · ${p.title}` }))} className="w-48" />
        <SelectFilter param="assignee" allLabel="Any assignee" label="Assignee" options={people.map((p) => ({ value: p.id, label: p.name }))} className="w-44" />
        <SelectFilter param="priority" allLabel="Any priority" label="Priority" options={PRIORITY_OPTIONS} />
        {view === "list" && <SelectFilter param="status" allLabel="Any status" label="Status" options={statuses.map((s) => ({ value: s.key, label: s.label }))} />}
        <SelectFilter param="due" allLabel="Any due date" label="Due" options={[{ value: "overdue", label: "Overdue" }, { value: "week", label: "Due this week" }]} />
        <ClearFilters keep={["scope", "view"]} />
      </FilterBar>
      {body}
    </PageBody>
  );
}
