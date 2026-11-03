import { Plus } from "lucide-react";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { can, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PRIORITIES, Project, Task } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, pageParam, PAGE_SIZE, param, withParams, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { notInList, searchAny } from "@/lib/sql";
import { addDays, todayKey, weekStart } from "@/lib/time";
import { keysInCategories, projectFilter, taskFilter, TASK_CLOSED_CATEGORIES, type Filter } from "@/lib/work-access";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ClearFilters, FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { assignedToTaskOrSubtask, queryTaskBoard, queryTasks, topLevelTask } from "./_components/task-query";
import { toTaskRows } from "./_components/task-rows";
import { TaskBoard, TaskTable } from "./_components/task-ui";
import { PRIORITY_OPTIONS } from "./_components/options";

export const metadata = { title: "Tasks" };

const BOARD_COLUMN_LIMIT = 30;

export default async function TasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const settings = await getSettings();
  const statuses = settings.taskStatuses;
  const closedKeys = keysInCategories(statuses, TASK_CLOSED_CATEGORIES);
  const today = todayKey();

  const scope = param(sp, "scope") === "all" ? "all" : "mine";
  const view = param(sp, "view") === "board" ? "board" : "list";
  const visible = await taskFilter(user);

  const conds: Filter[] = [visible, topLevelTask()];
  if (scope === "mine") conds.push(assignedToTaskOrSubtask(user._id));
  const projectId = idParam(sp, "project");
  if (projectId) conds.push(eq(Task.project, projectId));
  const assigneeId = idParam(sp, "assignee");
  if (assigneeId) conds.push(assignedToTaskOrSubtask(assigneeId));
  const priority = param(sp, "priority");
  if ((PRIORITIES as string[]).includes(priority)) conds.push(eq(Task.priority, priority as (typeof PRIORITIES)[number]));
  const status = param(sp, "status");
  if (statuses.some((s) => s.key === status)) conds.push(eq(Task.status, status));
  const due = param(sp, "due");
  if (due === "overdue") conds.push(lt(Task.dueDate, today), notInList(Task.status, closedKeys));
  if (due === "week") {
    const monday = weekStart(today);
    conds.push(gte(Task.dueDate, monday), lte(Task.dueDate, addDays(monday, 6)), notInList(Task.status, closedKeys));
  }
  const q = param(sp, "q");
  conds.push(searchAny(q, Task.title, Task.taskNo));
  const filter: Filter = and(...conds);

  const page = pageParam(sp);

  const [projects, people, canCreateAny] = await Promise.all([
    db().select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title }).from(Project).where(projectFilter(user)).orderBy(desc(Project.projectNo)).limit(300),
    peopleOptions(),
    can(user, "tasks.manage")
      ? Promise.resolve(true)
      : db()
          .select({ id: Project._id })
          .from(Project)
          .where(eq(Project.manager, user._id))
          .limit(1)
          .then((rows) => rows.length > 0),
  ]);

  let body;
  if (view === "list") {
    const [tasks, total] = await Promise.all([queryTasks(filter, closedKeys, (page - 1) * PAGE_SIZE, PAGE_SIZE), db().$count(Task, filter)]);
    const rows = await toTaskRows(user, tasks, settings);
    body = (
      <Card>
        <TaskTable rows={rows} statuses={statuses} empty={scope === "mine" && !q ? "Nothing is assigned to you right now." : "No tasks match these filters."} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    );
  } else {
    const columns = await queryTaskBoard(user, settings, filter, closedKeys, BOARD_COLUMN_LIMIT);
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
        <SelectFilter param="project" allLabel="All projects" label="Project" options={projects.map((p) => ({ value: p._id, label: `${p.projectNo} · ${p.title}` }))} className="w-48" />
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
