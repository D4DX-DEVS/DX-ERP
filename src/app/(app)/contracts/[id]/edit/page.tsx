import { forbidden } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Contract, Project, Proposal } from "@/lib/models";
import { projectFilter } from "@/lib/work-access";
import { PageBody, PageHeader } from "@/components/ui/page";
import { clientScope, hiddenClientIds, notHiddenClient, recordScope } from "@/app/(app)/crm/_lib/access";
import { pageContract } from "../../_access";
import { ContractForm } from "../../contract-form";

export const metadata = { title: "Edit contract" };

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission("contracts.view");
  if (!can(user, "contracts.manage")) forbidden();
  const c = await pageContract(user, id);
  await connectDB();
  const hidden = await hiddenClientIds(user);
  // The contract's current project / proposal stay selectable so saving doesn't silently unlink them.
  const [clients, projects, proposals, types] = await Promise.all([
    Client.find(clientScope(user), { name: 1, clientNo: 1 }).sort({ name: 1 }).limit(1000).lean(),
    Project.find({ $or: [{ $and: [projectFilter(user), { client: { $exists: true } }, notHiddenClient(hidden)] }, { _id: c.project ?? null }] }, { projectNo: 1, title: 1, client: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
    Proposal.find({ $or: [{ $and: [{ status: { $in: ["approved", "converted"] } }, recordScope(hidden, user, ["owner", "createdBy"])] }, { _id: c.proposal ?? null }] }, { proposalNo: 1, title: 1, client: 1 }).sort({ createdAt: -1 }).limit(500).lean(),
    Contract.distinct("type"),
  ]);
  // Make sure the contract's current client stays selectable even when it falls outside the first page of options.
  const hasClient = clients.some((x) => x._id.equals(c.client));
  const current = hasClient ? null : await Client.findById(c.client, { name: 1, clientNo: 1 }).lean();
  const clientOptions = [...clients, ...(current ? [current] : [])];

  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: `/contracts/${id}`, label: c.contractNo }} title="Edit contract" description={c.title} />
      <ContractForm
        mode="edit"
        statusLocked={c.status !== "draft" && c.status !== "active"}
        clients={clientOptions.map((x) => ({ id: x._id.toString(), name: x.name, clientNo: x.clientNo }))}
        projects={projects.map((p) => ({ id: p._id.toString(), label: `${p.projectNo} · ${p.title}`, client: p.client?.toString() }))}
        proposals={proposals.map((p) => ({ id: p._id.toString(), label: `${p.proposalNo} · ${p.title}`, client: p.client.toString() }))}
        types={["SOW", "MSA", "AMC", "NDA", ...(types as string[]).filter(Boolean)].filter((t, i, a) => a.indexOf(t) === i)}
        initial={{
          id,
          title: c.title,
          client: c.client.toString(),
          project: c.project?.toString() ?? "",
          proposal: c.proposal?.toString() ?? "",
          type: c.type ?? "",
          startDate: c.startDate ?? "",
          endDate: c.endDate ?? "",
          value: c.value ? String(c.value) : "",
          signedOn: c.signedOn ?? "",
          status: c.status === "draft" ? "draft" : "active",
          renewalReminderDays: String(c.renewalReminderDays),
          autoRenew: c.autoRenew,
          confidential: c.confidential,
          notes: c.notes ?? "",
        }}
      />
    </PageBody>
  );
}
