import { Plus } from "lucide-react";
import { Task, Types, type IProject } from "@/lib/models";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { pageParam, PAGE_SIZE, param, searchRegex, type SearchParams } from "@/lib/query";
import { canCreateTask, keysInCategories, taskFilter, TASK_CLOSED_CATEGORIES, type Filter } from "@/lib/work-access";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Segmented } from "@/components/ui/tabs";
import { queryTasks } from "../../tasks/_components/task-query";
import { toTaskRows } from "../../tasks/_components/task-rows";
import { TaskBoard, TaskTable, type BoardColumn } from "../../tasks/_components/task-ui";

const BOARD_COLUMN_LIMIT = 30;

/** Tasks tab of the project dashboard: list or board of the tasks the viewer may see, plus "New task". */
export async function TasksTab({ user, project, settings, sp }: { user: CurrentUser; project: Pick<IProject, "_id" | "manager">; settings: AppSettings; sp: SearchParams }) {
  const statuses = settings.taskStatuses;
  const closedKeys = keysInCategories(statuses, TASK_CLOSED_CATEGORIES);
  const view = param(sp, "view") === "board" ? "board" : "list";
  const base = `/projects/${project._id}`;

  const and: Filter[] = [{ project: new Types.ObjectId(project._id) }, await taskFilter(user)];
  const status = param(sp, "status");
  if (view === "list" && statuses.some((s) => s.key === status)) and.push({ status });
  const rx = searchRegex(param(sp, "q"));
  if (rx) and.push({ $or: [{ title: rx }, { taskNo: rx }] });
  const filter: Filter = { $and: and };

  let body;
  if (view === "list") {
    const page = pageParam(sp);
    const [tasks, total] = await Promise.all([queryTasks(filter, closedKeys, (page - 1) * PAGE_SIZE, PAGE_SIZE), Task.countDocuments(filter)]);
    const rows = await toTaskRows(user, tasks, settings);
    body = (
      <Card>
        <TaskTable rows={rows} statuses={statuses} showProject={false} empty="No tasks yet." />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    );
  } else {
    const columns: BoardColumn[] = await Promise.all(
      statuses.map(async (s) => {
        const colFilter: Filter = { $and: [...and, { status: s.key }] };
        const [tasks, total] = await Promise.all([queryTasks(colFilter, closedKeys, 0, BOARD_COLUMN_LIMIT), Task.countDocuments(colFilter)]);
        return { status: s, rows: await toTaskRows(user, tasks, settings), total };
      }),
    );
    body = <TaskBoard columns={columns} statuses={statuses} showProject={false} />;
  }

  const link = (v: string | null) => (v ? `${base}?tab=tasks&view=${v}` : `${base}?tab=tasks`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          items={[
            { href: link(null), label: "List", active: view === "list" },
            { href: link("board"), label: "Board", active: view === "board" },
          ]}
        />
        {canCreateTask(user, project) && (
          <ButtonLink href={`/tasks/new?project=${project._id}`} icon={<Plus className="size-4" aria-hidden />}>
            New task
          </ButtonLink>
        )}
      </div>
      <FilterBar>
        <SearchInput placeholder="Search tasks" />
        {view === "list" && <SelectFilter param="status" allLabel="Any status" label="Status" options={statuses.map((s) => ({ value: s.key, label: s.label }))} />}
      </FilterBar>
      {body}
    </div>
  );
}
