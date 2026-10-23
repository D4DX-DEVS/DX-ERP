import { forbidden } from "next/navigation";
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Contract, Project, Proposal } from "@/lib/models";
import { inList } from "@/lib/sql";
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
  const hidden = await hiddenClientIds(user);
  // The contract's current project / proposal stay selectable so saving doesn't silently unlink them.
  const [clients, projects, proposals, types] = await Promise.all([
    db().select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo }).from(Client).where(clientScope(user)).orderBy(asc(Client.name)).limit(1000),
    db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, client: Project.client })
      .from(Project)
      .where(or(and(projectFilter(user), isNotNull(Project.client), notHiddenClient(hidden, Project.client)), c.project ? eq(Project._id, c.project) : undefined))
      .orderBy(desc(Project.createdAt))
      .limit(500),
    db()
      .select({ _id: Proposal._id, proposalNo: Proposal.proposalNo, title: Proposal.title, client: Proposal.client })
      .from(Proposal)
      .where(
        or(
          and(inList(Proposal.status, ["approved", "converted"]), recordScope(hidden, user, Proposal.client, [Proposal.owner, Proposal.createdBy])),
          c.proposal ? eq(Proposal._id, c.proposal) : undefined,
        ),
      )
      .orderBy(desc(Proposal.createdAt))
      .limit(500),
    db().selectDistinct({ type: Contract.type }).from(Contract),
  ]);
  // Make sure the contract's current client stays selectable even when it falls outside the first page of options.
  const hasClient = clients.some((x) => x._id === c.client);
  const [current] = hasClient ? [] : await db().select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo }).from(Client).where(eq(Client._id, c.client)).limit(1);
  const clientOptions = [...clients, ...(current ? [current] : [])];

  return (
    <PageBody className="max-w-4xl">
      <PageHeader back={{ href: `/contracts/${id}`, label: c.contractNo }} title="Edit contract" description={c.title} />
      <ContractForm
        mode="edit"
        statusLocked={c.status !== "draft" && c.status !== "active"}
        clients={clientOptions.map((x) => ({ id: x._id, name: x.name, clientNo: x.clientNo }))}
        projects={projects.map((p) => ({ id: p._id, label: `${p.projectNo} · ${p.title}`, client: p.client ?? undefined }))}
        proposals={proposals.map((p) => ({ id: p._id, label: `${p.proposalNo} · ${p.title}`, client: p.client }))}
        types={["SOW", "MSA", "AMC", "NDA", ...types.map((t) => t.type).filter((t): t is string => Boolean(t))].filter((t, i, a) => a.indexOf(t) === i)}
        initial={{
          id,
          title: c.title,
          client: c.client,
          project: c.project ?? "",
          proposal: c.proposal ?? "",
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
