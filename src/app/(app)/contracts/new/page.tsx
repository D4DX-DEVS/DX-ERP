import { and, asc, desc, isNotNull } from "drizzle-orm";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Contract, Project, Proposal } from "@/lib/models";
import { idParam, type SearchParams } from "@/lib/query";
import { inList } from "@/lib/sql";
import { projectFilter } from "@/lib/work-access";
import { PageBody, PageHeader } from "@/components/ui/page";
import { clientScope, hiddenClientIds, notHiddenClient, recordScope } from "@/app/(app)/crm/_lib/access";
import { ContractForm } from "../contract-form";

export const metadata = { title: "New contract" };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("contracts.manage");
  const sp = await searchParams;
  const hidden = await hiddenClientIds(user);
  const [clients, projects, proposals, types] = await Promise.all([
    db().select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo }).from(Client).where(clientScope(user)).orderBy(asc(Client.name)).limit(1000),
    db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, client: Project.client })
      .from(Project)
      .where(and(projectFilter(user), isNotNull(Project.client), notHiddenClient(hidden, Project.client)))
      .orderBy(desc(Project.createdAt))
      .limit(500),
    db()
      .select({ _id: Proposal._id, proposalNo: Proposal.proposalNo, title: Proposal.title, client: Proposal.client })
      .from(Proposal)
      .where(and(inList(Proposal.status, ["approved", "converted"]), recordScope(hidden, user, Proposal.client, [Proposal.owner, Proposal.createdBy])))
      .orderBy(desc(Proposal.createdAt))
      .limit(500),
    db().selectDistinct({ type: Contract.type }).from(Contract),
  ]);
  const wanted = idParam(sp, "client");
  const clientId = wanted && clients.some((c) => c._id === wanted) ? wanted : "";
  const proposalId = idParam(sp, "proposal");
  const preProposal = proposalId ? proposals.find((p) => p._id === proposalId) : undefined;

  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: "/contracts", label: "Contracts" }} title="New contract" description="Record a signed contract or one awaiting signature, and link it to the client and project." />
      <ContractForm
        mode="create"
        clients={clients.map((c) => ({ id: c._id, name: c.name, clientNo: c.clientNo }))}
        projects={projects.map((p) => ({ id: p._id, label: `${p.projectNo} · ${p.title}`, client: p.client ?? undefined }))}
        proposals={proposals.map((p) => ({ id: p._id, label: `${p.proposalNo} · ${p.title}`, client: p.client }))}
        types={["SOW", "MSA", "AMC", "NDA", ...types.map((t) => t.type).filter((t): t is string => Boolean(t))].filter((t, i, a) => a.indexOf(t) === i)}
        initial={{
          title: preProposal?.title ?? "",
          client: preProposal ? preProposal.client : clientId,
          project: "",
          proposal: preProposal?._id ?? "",
          type: "",
          startDate: "",
          endDate: "",
          value: "",
          signedOn: "",
          status: "active",
          renewalReminderDays: "30",
          autoRenew: false,
          confidential: true,
          notes: "",
        }}
      />
    </PageBody>
  );
}
