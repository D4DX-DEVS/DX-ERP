import { forbidden } from "next/navigation";
import { and, desc } from "drizzle-orm";
import { can, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Project, Task } from "@/lib/models";
import { peopleOptions } from "@/lib/people";
import { idParam, type SearchParams } from "@/lib/query";
import { getSettings } from "@/lib/settings";
import { inList, notInList } from "@/lib/sql";
import { keysInCategories, myProjectIds, projectFilter, taskFilter } from "@/lib/work-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page";
import { IssueForm } from "../issue-form";

export const metadata = { title: "Report issue" };

export default async function NewIssuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const settings = await getSettings();
  const qaManager = can(user, "qa.manage");
  const cancelled = keysInCategories(settings.projectStatuses, ["cancelled"]);

  const ownIds = qaManager ? [] : await myProjectIds(user);
  if (!qaManager && ownIds.length === 0) forbidden();
  const projects = await db()
    .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, manager: Project.manager })
    .from(Project)
    .where(and(qaManager ? projectFilter(user) : inList(Project._id, ownIds), notInList(Project.status, cancelled)))
    .orderBy(desc(Project.projectNo))
    .limit(300);
  const projectIds = projects.map((p) => p._id);
  const tasks = projectIds.length
    ? await db()
        .select({ _id: Task._id, taskNo: Task.taskNo, title: Task.title, project: Task.project })
        .from(Task)
        .where(and(inList(Task.project, projectIds), await taskFilter(user)))
        .orderBy(desc(Task.createdAt))
        .limit(800)
    : [];
  const canAssign = qaManager || projects.some((p) => p.manager === user.id);

  const wantedProject = idParam(sp, "project");
  const wantedTask = idParam(sp, "task");
  const initialProject = wantedProject && projects.some((p) => p._id === wantedProject) ? wantedProject : "";

  return (
    <PageBody>
      <PageHeader back={{ href: "/qa", label: "QA & issues" }} title="Report issue" />
      <Card>
        <CardBody className="pt-5">
          <IssueForm
            projects={projects.map((p) => ({ id: p._id, label: `${p.projectNo} · ${p.title}` }))}
            tasks={tasks.map((t) => ({ id: t._id, label: `${t.taskNo} · ${t.title}`, project: t.project ?? "" }))}
            people={canAssign ? await peopleOptions() : undefined}
            initial={{ project: initialProject, task: wantedTask ?? "" }}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
}
