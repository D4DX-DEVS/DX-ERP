import "server-only";
import { and, asc, desc, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
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
  const settings = await getSettings();
  const showContracts = can(user, "contracts.view");
  const privileged = can(user, "contracts.manage") || can(user, "crm.confidential");
  // Restricted clients (and their projects / contracts) are offered only to people who may see them.
  const hidden = await hiddenClientIds(user);
  const [clients, projects, contracts] = await Promise.all([
    db()
      .select({ _id: Client._id, name: Client.name, clientNo: Client.clientNo, address: Client.address })
      .from(Client)
      .where(and(ne(Client.status, "lost"), clientScope(user)))
      .orderBy(asc(Client.name))
      .limit(2000),
    db()
      .select({ _id: Project._id, projectNo: Project.projectNo, title: Project.title, client: Project.client, contract: Project.contract, milestones: Project.milestones })
      .from(Project)
      .where(and(isNotNull(Project.client), eq(Project.internal, false), notHiddenClient(hidden, Project.client)))
      .orderBy(desc(Project.createdAt))
      .limit(1000),
    showContracts
      ? db()
          .select({ _id: Contract._id, contractNo: Contract.contractNo, title: Contract.title, client: Contract.client, confidential: Contract.confidential })
          .from(Contract)
          .where(and(ne(Contract.status, "terminated"), notHiddenClient(hidden, Contract.client)))
          .orderBy(desc(Contract.createdAt))
          .limit(1000)
      : Promise.resolve(null),
  ]);
  return {
    clients: clients.map((c) => ({ id: c._id, name: c.name, clientNo: c.clientNo, state: c.address?.state })),
    projects: projects.map((p) => ({
      id: p._id,
      client: p.client!,
      label: `${p.projectNo} · ${p.title}`,
      contract: p.contract ?? undefined,
      milestones: p.milestones
        .filter((m) => !m.invoiced || m.invoice === invoiceId)
        .map((m) => ({ id: m._id, title: m.title, amount: m.amount ?? 0 })),
    })),
    // Confidential contracts show only their number to people who may not read them.
    contracts: contracts ? contracts.map((c) => ({ id: c._id, client: c.client, label: c.confidential && !privileged ? c.contractNo : `${c.contractNo} · ${c.title}` })) : null,
    taxes: settings.taxes,
    paymentTerms: settings.paymentTerms,
    defaults: { notes: settings.documents.invoiceNotes, terms: settings.documents.invoiceTerms },
  };
}
