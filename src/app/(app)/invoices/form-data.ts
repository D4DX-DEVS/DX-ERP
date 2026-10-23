import "server-only";
import { connectDB } from "@/lib/db";
import { Client, Contract, Project } from "@/lib/models";
import { can, type CurrentUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { clientScope, hiddenClientIds, notHiddenClient } from "@/app/(app)/crm/_lib/access";
import type { ClientOption, ContractOption, ProjectOption } from "./invoice-form";

/** Option lists for the invoice form: clients, their projects (with un-invoiced milestones) and contracts. */
export async function loadInvoiceFormOptions(
  user: CurrentUser,
  invoiceId?: string,
): Promise<{ clients: ClientOption[]; projects: ProjectOption[]; contracts: ContractOption[] | null; taxes: { name: string; rate: number }[]; paymentTerms: { label: string; days: number }[]; defaults: { notes: string; terms: string } }> {
  await connectDB();
  const settings = await getSettings();
  const showContracts = can(user, "contracts.view");
  const privileged = can(user, "contracts.manage") || can(user, "crm.confidential");
  // Restricted clients (and their projects / contracts) are offered only to people who may see them.
  const hidden = await hiddenClientIds(user);
  const [clients, projects, contracts] = await Promise.all([
    Client.find({ status: { $ne: "lost" }, ...clientScope(user) }, { name: 1, clientNo: 1, address: 1 }).sort({ name: 1 }).limit(2000).lean(),
    Project.find({ client: { $exists: true, $ne: null }, internal: { $ne: true }, ...notHiddenClient(hidden) }, { projectNo: 1, title: 1, client: 1, contract: 1, milestones: 1 }).sort({ createdAt: -1 }).limit(1000).lean(),
    showContracts ? Contract.find({ status: { $ne: "terminated" }, ...notHiddenClient(hidden) }, { contractNo: 1, title: 1, client: 1, confidential: 1 }).sort({ createdAt: -1 }).limit(1000).lean() : Promise.resolve(null),
  ]);
  return {
    clients: clients.map((c) => ({ id: c._id.toString(), name: c.name, clientNo: c.clientNo, state: c.address?.state })),
    projects: projects.map((p) => ({
      id: p._id.toString(),
      client: p.client!.toString(),
      label: `${p.projectNo} · ${p.title}`,
      contract: p.contract?.toString(),
      milestones: p.milestones
        .filter((m) => !m.invoiced || m.invoice?.toString() === invoiceId)
        .map((m) => ({ id: m._id.toString(), title: m.title, amount: m.amount ?? 0 })),
    })),
    // Confidential contracts show only their number to people who may not read them.
    contracts: contracts ? contracts.map((c) => ({ id: c._id.toString(), client: c.client.toString(), label: c.confidential && !privileged ? c.contractNo : `${c.contractNo} · ${c.title}` })) : null,
    taxes: settings.taxes,
    paymentTerms: settings.paymentTerms,
    defaults: { notes: settings.documents.invoiceNotes, terms: settings.documents.invoiceTerms },
  };
}
