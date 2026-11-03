import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { Task, type IProject } from "@/lib/models";
import type { CurrentUser } from "@/lib/auth/session";
import type { AppSettings } from "@/lib/config-defaults";
import { pageParam, PAGE_SIZE, param, type SearchParams } from "@/lib/query";
import { searchAny } from "@/lib/sql";
import { keysInCategories, taskFilter, TASK_CLOSED_CATEGORIES, type Filter } from "@/lib/work-access";
import { Card } from "@/components/ui/card";
import { FilterBar, Pagination, SearchInput, SelectFilter } from "@/components/ui/filters";
import { Segmented } from "@/components/ui/tabs";
import { queryTaskBoard, queryTasks, topLevelTask } from "../../tasks/_components/task-query";
import { toTaskRows } from "../../tasks/_components/task-rows";
import { TaskBoard, TaskTable } from "../../tasks/_components/task-ui";

const BOARD_COLUMN_LIMIT = 30;

/** Tasks tab of the project dashboard: list or board of the top-level tasks the viewer may see. */
export async function TasksTab({ user, project, settings, sp }: { user: CurrentUser; project: Pick<IProject, "_id" | "manager" | "team">; settings: AppSettings; sp: SearchParams }) {
  const statuses = settings.taskStatuses;
  const closedKeys = keysInCategories(statuses, TASK_CLOSED_CATEGORIES);
  const view = param(sp, "view") === "board" ? "board" : "list";
  const base = `/projects/${project._id}`;

  const conds: Filter[] = [eq(Task.project, project._id), topLevelTask(), await taskFilter(user)];
  const status = param(sp, "status");
  if (view === "list" && statuses.some((s) => s.key === status)) conds.push(eq(Task.status, status));
  conds.push(searchAny(param(sp, "q"), Task.title, Task.taskNo));
  const filter: Filter = and(...conds);

  let body;
  if (view === "list") {
    const page = pageParam(sp);
    const [tasks, total] = await Promise.all([queryTasks(filter, closedKeys, (page - 1) * PAGE_SIZE, PAGE_SIZE), db().$count(Task, filter)]);
    const rows = await toTaskRows(user, tasks, settings);
    body = (
      <Card>
        <TaskTable rows={rows} statuses={statuses} showProject={false} empty="No tasks yet." />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </Card>
    );
  } else {
    const columns = await queryTaskBoard(user, settings, filter, closedKeys, BOARD_COLUMN_LIMIT);
    body = <TaskBoard columns={columns} statuses={statuses} showProject={false} />;
  }

  const link = (v: string | null) => (v ? `${base}?tab=tasks&view=${v}` : `${base}?tab=tasks`);

  return (
    <div className="flex flex-col gap-4">
      {/* "Add task" lives in the project header, so the tab has no button of its own. */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          items={[
            { href: link(null), label: "List", active: view === "list" },
            { href: link("board"), label: "Board", active: view === "board" },
          ]}
        />
      </div>
      <FilterBar>
        <SearchInput placeholder="Search tasks" />
        {view === "list" && <SelectFilter param="status" allLabel="Any status" label="Status" options={statuses.map((s) => ({ value: s.key, label: s.label }))} />}
      </FilterBar>
      {body}
    </div>
  );
}
