import { forbidden } from "next/navigation";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Project, Task } from "@/lib/models";
import { idParam, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { canCreateTask, projectFilter, taskFilter } from "@/lib/work-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page";
import { TaskForm } from "../_components/task-form";
import { loadTaskFormOptions } from "../_components/task-form-data";

export const metadata = { title: "New task" };

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await connectDB();
  const settings = await getSettings();
  const managesAny = can(user, "tasks.manage") || Boolean(await Project.exists({ manager: user._id }));
  if (!managesAny) forbidden();

  const parentId = idParam(sp, "parent");
  const parent = parentId ? await Task.findOne({ $and: [{ _id: parentId }, await taskFilter(user)] }, { taskNo: 1, title: 1, project: 1, parent: 1, milestone: 1 }).lean() : null;
  const projectId = parent ? parent.project?.toString() : idParam(sp, "project");
  const project = projectId ? await Project.findOne({ $and: [{ _id: projectId }, projectFilter(user)] }, { manager: 1, milestones: 1 }).lean() : null;
  if (projectId && !project) forbidden();
  if (!canCreateTask(user, project)) forbidden();

  const options = await loadTaskFormOptions(user, settings, project ? [project._id] : []);
  const milestone = parent?.milestone?.toString() ?? idParam(sp, "milestone");
  const subtask = Boolean(parent);

  return (
    <PageBody>
      <PageHeader back={{ href: projectId ? `/projects/${projectId}?tab=tasks` : "/tasks", label: projectId ? "Project" : "Tasks" }} title={subtask ? "New subtask" : "New task"} />
      <Card>
        <CardBody className="pt-5">
          <TaskForm
            projects={options.projects}
            dependencies={options.dependencies}
            people={options.people}
            canPickNoProject={can(user, "tasks.manage")}
            lockProject={subtask}
            initial={{
              project: projectId,
              milestone: milestone && project?.milestones.some((m) => m._id.toString() === milestone) ? milestone : undefined,
              parent: parent?._id.toString(),
              parentLabel: parent ? `${parent.taskNo} · ${parent.title}` : undefined,
              title: "",
              description: "",
              assignees: [],
              priority: "medium",
              startDate: "",
              dueDate: "",
              estimateHours: "",
              dependencies: [],
              sharedWith: [],
              isLearning: false,
            }}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
}
