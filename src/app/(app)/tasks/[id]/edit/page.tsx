import { forbidden, notFound } from "next/navigation";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Project, Task } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { isObjectId } from "@/lib/validation";
import { taskCaps, taskFilter } from "@/lib/work-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page";
import { TaskForm } from "../../_components/task-form";
import { loadTaskFormOptions } from "../../_components/task-form-data";

export const metadata = { title: "Edit task" };

export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const user = await requireUser();
  await connectDB();
  const task = await Task.findOne({ $and: [{ _id: id }, await taskFilter(user)] }).lean();
  if (!task) notFound();
  const project = task.project ? await Project.findById(task.project, { manager: 1 }).lean() : null;
  if (!taskCaps(user, task, project?.manager).manage) forbidden();

  const settings = await getSettings();
  const options = await loadTaskFormOptions(user, settings, project ? [project._id] : []);

  return (
    <PageBody>
      <PageHeader back={{ href: `/tasks/${id}`, label: task.taskNo }} title="Edit task" />
      <Card>
        <CardBody className="pt-5">
          <TaskForm
            projects={options.projects}
            dependencies={options.dependencies}
            people={options.people}
            canPickNoProject={can(user, "tasks.manage")}
            lockProject
            initial={{
              id,
              project: task.project?.toString(),
              milestone: task.milestone?.toString(),
              parent: task.parent?.toString(),
              title: task.title,
              description: task.description ?? "",
              assignees: task.assignees.map(String),
              reviewer: task.reviewer?.toString(),
              priority: task.priority,
              startDate: task.startDate ?? "",
              dueDate: task.dueDate ?? "",
              estimateHours: task.estimateHours ? String(task.estimateHours) : "",
              dependencies: task.dependencies.map(String),
              sharedWith: task.sharedWith.map(String),
              isLearning: task.isLearning,
            }}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
}
