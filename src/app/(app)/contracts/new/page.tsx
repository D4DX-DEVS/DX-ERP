import { requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Contract, Project, Proposal } from "@/lib/models";
import { idParam, type SearchParams } from "@/lib/query";
import { projectFilter } from "@/lib/work-access";
import { PageBody, PageHeader } from "@/components/ui/page";
import { clientScope, hiddenClientIds, notHiddenClient, recordScope } from "@/app/(app)/crm/_lib/access";
import { ContractForm } from "../contract-form";

export const metadata = { title: "New contract" };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePagePermission("contracts.manage");
  const sp = await searchParams;
  await connectDB();
  const hidden = await hiddenClientIds(user);
  const [clients, projects, proposals, types] = await Promise.all([
    Client.find(clientScope(user), { name: 1, clientNo: 1 }).sort({ name: 1 }).limit(1000).lean(),
    Project.find({ $and: [projectFilter(user), { client: { $exists: true } }, notHiddenClient(hidden)] }, { projectNo: 1, title: 1, client: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
    Proposal.find({ $and: [{ status: { $in: ["approved", "converted"] } }, recordScope(hidden, user, ["owner", "createdBy"])] }, { proposalNo: 1, title: 1, client: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
    Contract.distinct("type"),
  ]);
  const wanted = idParam(sp, "client");
  const clientId = wanted && clients.some((c) => c._id.toString() === wanted) ? wanted : "";
  const proposalId = idParam(sp, "proposal");
  const preProposal = proposalId ? proposals.find((p) => p._id.toString() === proposalId) : undefined;

  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: "/contracts", label: "Contracts" }} title="New contract" description="Record a signed contract or one awaiting signature, and link it to the client and project." />
      <ContractForm
        mode="create"
        clients={clients.map((c) => ({ id: c._id.toString(), name: c.name, clientNo: c.clientNo }))}
        projects={projects.map((p) => ({ id: p._id.toString(), label: `${p.projectNo} · ${p.title}`, client: p.client?.toString() }))}
        proposals={proposals.map((p) => ({ id: p._id.toString(), label: `${p.proposalNo} · ${p.title}`, client: p.client.toString() }))}
        types={["SOW", "MSA", "AMC", "NDA", ...(types as string[]).filter(Boolean)].filter((t, i, a) => a.indexOf(t) === i)}
        initial={{
          title: preProposal?.title ?? "",
          client: preProposal ? preProposal.client.toString() : clientId,
          project: "",
          proposal: preProposal?._id.toString() ?? "",
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
