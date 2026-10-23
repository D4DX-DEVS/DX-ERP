import { forbidden } from "next/navigation";
import { can, requireUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Project, Task } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { keysInCategories, myProjectIds, projectFilter, taskFilter } from "@/lib/work-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page";
import { IssueForm } from "../issue-form";

export const metadata = { title: "Report issue" };

export default async function NewIssuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await connectDB();
  const settings = await getSettings();
  const qaManager = can(user, "qa.manage");
  const cancelled = keysInCategories(settings.projectStatuses, ["cancelled"]);

  const ownIds = qaManager ? [] : await myProjectIds(user);
  if (!qaManager && ownIds.length === 0) forbidden();
  const projects = await Project.find({ ...(qaManager ? projectFilter(user) : { _id: { $in: ownIds } }), status: { $nin: cancelled } }, { projectNo: 1, title: 1, manager: 1 }).sort({ projectNo: -1 }).limit(300).lean();
  const projectIds = projects.map((p) => p._id);
  const tasks = projectIds.length
    ? await Task.find({ $and: [{ project: { $in: projectIds } }, await taskFilter(user)] }, { taskNo: 1, title: 1, project: 1 }).sort({ createdAt: -1 }).limit(800).lean()
    : [];
  const canAssign = qaManager || projects.some((p) => p.manager?.toString() === user.id);

  const wantedProject = idParam(sp, "project");
  const wantedTask = idParam(sp, "task");
  const initialProject = wantedProject && projects.some((p) => p._id.toString() === wantedProject) ? wantedProject : "";

  return (
    <PageBody>
      <PageHeader back={{ href: "/qa", label: "QA & issues" }} title="Report issue" />
      <Card>
        <CardBody className="pt-5">
          <IssueForm
            projects={projects.map((p) => ({ id: p._id.toString(), label: `${p.projectNo} · ${p.title}` }))}
            tasks={tasks.map((t) => ({ id: t._id.toString(), label: `${t.taskNo} · ${t.title}`, project: t.project?.toString() ?? "" }))}
            people={canAssign ? await peopleOptions() : undefined}
            initial={{ project: initialProject, task: wantedTask ?? "" }}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
}
