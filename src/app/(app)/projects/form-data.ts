import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { Client, Contract, Proposal, type Id } from "@/lib/models";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { peopleOptions } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { canSeeClient } from "@/lib/work-access";
import type { Reference } from "./project-form";

/** Select options for the project form: clients the user may see, proposals / contracts they may view, staff. */
export async function loadProjectFormOptions(user: CurrentUser, existing?: { client?: Id | null }) {
  const settings = await getSettings();
  // Without CRM access only the project's current client is offered, never the client list.
  const clientCols = { _id: Client._id, name: Client.name, confidential: Client.confidential, owner: Client.owner };
  const clientDocs = can(user, "crm.view")
    ? await db().select(clientCols).from(Client).orderBy(asc(Client.name)).limit(1000)
    : existing?.client
      ? await db().select(clientCols).from(Client).where(eq(Client._id, existing.client))
      : [];
  const clients = clientDocs
    .filter((c) => canSeeClient(user, c) || c._id === existing?.client)
    .map((c) => ({ id: c._id, name: canSeeClient(user, c) ? c.name : "Restricted client" }));

  const [proposalDocs, contractDocs, people] = await Promise.all([
    can(user, "proposals.view")
      ? db().select({ _id: Proposal._id, proposalNo: Proposal.proposalNo, title: Proposal.title, client: Proposal.client }).from(Proposal).orderBy(desc(Proposal.createdAt)).limit(500)
      : null,
    can(user, "contracts.view")
      ? db().select({ _id: Contract._id, contractNo: Contract.contractNo, title: Contract.title, client: Contract.client }).from(Contract).orderBy(desc(Contract.createdAt)).limit(500)
      : null,
    peopleOptions(),
  ]);
  const visibleClients = new Set(clients.map((c) => c.id));
  const proposals: Reference[] | undefined = proposalDocs?.filter((p) => visibleClients.has(p.client)).map((p) => ({ id: p._id, label: `${p.proposalNo} · ${p.title}`, client: p.client }));
  const contracts: Reference[] | undefined = contractDocs?.filter((c) => visibleClients.has(c.client)).map((c) => ({ id: c._id, label: `${c.contractNo} · ${c.title}`, client: c.client }));
  return { settings, clients, proposals, contracts, people, statuses: settings.projectStatuses.map((s) => ({ key: s.key, label: s.label })) };
}
