import { requirePagePermission, can } from "@/lib/auth/session";
import { Card, CardBody } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page";
import { firstInCategory } from "@/lib/work-access";
import { loadProjectFormOptions } from "../form-data";
import { ProjectForm } from "../project-form";

export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const user = await requirePagePermission("projects.manage");
  const { settings, clients, proposals, contracts, people, statuses } = await loadProjectFormOptions(user);
  return (
    <PageBody>
      <PageHeader back={{ href: "/projects", label: "Projects" }} title="New project" />
      <Card>
        <CardBody className="pt-5">
          <ProjectForm
            clients={clients}
            proposals={proposals}
            contracts={contracts}
            statuses={statuses}
            people={people}
            showBudget={can(user, "projects.financials")}
            initial={{
              title: "",
              internal: false,
              client: "",
              description: "",
              scope: "",
              deliverables: "",
              manager: "",
              team: [],
              startDate: "",
              targetDate: "",
              budget: "",
              estimatedHours: "",
              priority: "medium",
              status: firstInCategory(settings.projectStatuses, "planning") ?? settings.projectStatuses[0]?.key ?? "",
              proposal: "",
              contract: "",
            }}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
}
