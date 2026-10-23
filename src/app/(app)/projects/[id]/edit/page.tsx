import { forbidden, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Project } from "@/lib/models";
import { isObjectId } from "@/lib/validation";
import { projectCaps } from "@/lib/work-access";
import { Card, CardBody } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page";
import { loadProjectFormOptions } from "../../form-data";
import { ProjectForm } from "../../project-form";

export const metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isObjectId(id)) notFound();
  const user = await requireUser();
  const [project] = await db().select().from(Project).where(eq(Project._id, id)).limit(1);
  if (!project) notFound();
  const caps = projectCaps(user, project);
  if (!caps.view) notFound();
  if (!caps.manage) forbidden();
  const { clients, proposals, contracts, people, statuses } = await loadProjectFormOptions(user, project);

  return (
    <PageBody>
      <PageHeader back={{ href: `/projects/${id}`, label: project.projectNo }} title="Edit project" />
      <Card>
        <CardBody className="pt-5">
          <ProjectForm
            clients={clients}
            proposals={proposals}
            contracts={contracts}
            statuses={statuses}
            people={people}
            showBudget={caps.financials}
            initial={{
              id,
              title: project.title,
              internal: project.internal,
              client: project.client ?? "",
              description: project.description ?? "",
              scope: project.scope ?? "",
              deliverables: project.deliverables.join("\n"),
              manager: project.manager ?? "",
              team: project.team.map((m) => ({ user: m.user, role: m.role ?? "", allocation: String(m.allocation) })),
              startDate: project.startDate ?? "",
              targetDate: project.targetDate ?? "",
              budget: caps.financials && project.budget ? String(project.budget) : "",
              estimatedHours: project.estimatedHours ? String(project.estimatedHours) : "",
              priority: project.priority,
              status: project.status,
              proposal: project.proposal ?? "",
              contract: project.contract ?? "",
            }}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
}
