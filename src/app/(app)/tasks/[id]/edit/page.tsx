import { forbidden, notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { can, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Project, Task, User } from "@/lib/models";
import { inList } from "@/lib/sql";
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
  const [task] = await db()
    .select()
    .from(Task)
    .where(and(eq(Task._id, id), await taskFilter(user)))
    .limit(1);
  if (!task) notFound();
  const [project] = task.project ? await db().select({ _id: Project._id, manager: Project.manager }).from(Project).where(eq(Project._id, task.project)).limit(1) : [];
  if (!taskCaps(user, task, project?.manager).manage) forbidden();

  const settings = await getSettings();
  const options = await loadTaskFormOptions(user, settings, project ? [project._id] : []);
  // People on the task who have since left aren't in the picker options; list them so they can be seen and removed.
  const listed = new Set(options.people.map((p) => p.id));
  const missing = [...new Set([...task.assignees, ...task.sharedWith, ...(task.reviewer ? [task.reviewer] : [])])].filter((p) => !listed.has(p));
  const leavers = missing.length ? await db().select({ id: User._id, name: User.name, employeeId: User.employeeId }).from(User).where(inList(User._id, missing)) : [];
  const people = [...options.people, ...leavers.map((l) => ({ id: l.id, name: `${l.name} (left)`, employeeId: l.employeeId }))];

  return (
    <PageBody>
      <PageHeader back={{ href: `/tasks/${id}`, label: task.taskNo }} title="Edit task" />
      <Card>
        <CardBody className="pt-5">
          <TaskForm
            projects={options.projects}
            dependencies={options.dependencies}
            people={people}
            canPickNoProject={can(user, "tasks.manage")}
            lockProject
            initial={{
              id,
              project: task.project ?? undefined,
              milestone: task.milestone ?? undefined,
              parent: task.parent ?? undefined,
              title: task.title,
              description: task.description ?? "",
              assignees: task.assignees,
              reviewer: task.reviewer ?? undefined,
              priority: task.priority,
              startDate: task.startDate ?? "",
              dueDate: task.dueDate ?? "",
              estimateHours: task.estimateHours ? String(task.estimateHours) : "",
              dependencies: task.dependencies,
              sharedWith: task.sharedWith,
              isLearning: task.isLearning,
            }}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
}
