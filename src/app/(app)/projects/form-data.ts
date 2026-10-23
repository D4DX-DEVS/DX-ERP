import "server-only";
import { Client, Contract, Proposal, type ObjectId } from "@/lib/models";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { peopleOptions } from "@/lib/people";
import { getSettings } from "@/lib/settings";
import { canSeeClient } from "@/lib/work-access";
import type { Reference } from "./project-form";

/** Select options for the project form: clients the user may see, proposals / contracts they may view, staff. */
export async function loadProjectFormOptions(user: CurrentUser, existing?: { client?: ObjectId | null }) {
  await connectDB();
  const settings = await getSettings();
  // Without CRM access only the project's current client is offered, never the client list.
  const clientDocs = can(user, "crm.view")
    ? await Client.find({}, { name: 1, confidential: 1, owner: 1 }).sort({ name: 1 }).limit(1000).lean()
    : existing?.client
      ? await Client.find({ _id: existing.client }, { name: 1, confidential: 1, owner: 1 }).lean()
      : [];
  const clients = clientDocs
    .filter((c) => canSeeClient(user, c) || c._id.toString() === existing?.client?.toString())
    .map((c) => ({ id: c._id.toString(), name: canSeeClient(user, c) ? c.name : "Restricted client" }));

  const [proposalDocs, contractDocs, people] = await Promise.all([
    can(user, "proposals.view") ? Proposal.find({}, { proposalNo: 1, title: 1, client: 1 }).sort({ createdAt: -1 }).limit(500).lean() : null,
    can(user, "contracts.view") ? Contract.find({}, { contractNo: 1, title: 1, client: 1 }).sort({ createdAt: -1 }).limit(500).lean() : null,
    peopleOptions(),
  ]);
  const visibleClients = new Set(clients.map((c) => c.id));
  const proposals: Reference[] | undefined = proposalDocs?.filter((p) => visibleClients.has(p.client.toString())).map((p) => ({ id: p._id.toString(), label: `${p.proposalNo} · ${p.title}`, client: p.client.toString() }));
  const contracts: Reference[] | undefined = contractDocs?.filter((c) => visibleClients.has(c.client.toString())).map((c) => ({ id: c._id.toString(), label: `${c.contractNo} · ${c.title}`, client: c.client.toString() }));
  return { settings, clients, proposals, contracts, people, statuses: settings.projectStatuses.map((s) => ({ key: s.key, label: s.label })) };
}
