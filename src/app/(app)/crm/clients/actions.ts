"use server";

import { z } from "zod";
import { actionPermission, ActionError, parse, runAction, type ActionResult } from "@/lib/actions";
import { can } from "@/lib/auth/session";
import { audit, diff } from "@/lib/audit";
import { ID_PREFIX, nextNumber } from "@/lib/counters";
import { Activity, Client, Contract, Invoice, Lead, Project, Proposal, StoredFile, User } from "@/lib/models";
import { notify } from "@/lib/notify";
import { EXITED_STATUSES } from "@/lib/people";
import { zs } from "@/lib/validation";
import { actionClient } from "../_lib/access";
import { findDuplicates, type DuplicateReport } from "../_lib/duplicates";
import { CLIENT_STATUS_VALUES } from "../_lib/constants";

export type ClientSaveResult = { id: string } | { duplicates: DuplicateReport };

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const clientFields = {
  name: zs.text("Name", 200),
  type: z.enum(["company", "individual"], { error: "Choose company or individual" }),
  contactPerson: zs.optText(200),
  contactDesignation: zs.optText(200),
  email: zs.optEmail(),
  phone: zs.optText(40),
  altPhone: zs.optText(40),
  website: zs.optText(200),
  industry: zs.optText(100),
  gstin: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : undefined), z.string().regex(GSTIN, "Enter a valid 15-character GSTIN").optional()),
  addressLine1: zs.optText(200),
  addressLine2: zs.optText(200),
  city: zs.optText(100),
  state: zs.optText(100),
  postalCode: zs.optText(20),
  country: zs.optText(100),
  leadSource: zs.optText(100),
  owner: zs.optId(),
  status: z.enum(CLIENT_STATUS_VALUES, { error: "Choose a status" }),
  confidential: zs.bool(),
  notes: zs.optText(5000),
};

const createSchema = z.object({ ...clientFields, confirmDuplicates: zs.bool() });
const updateSchema = z.object(clientFields);

function assertPhones(...phones: (string | undefined)[]): void {
  for (const p of phones) {
    if (p && p.replace(/\D/g, "").length < 7) throw new ActionError("Enter a valid phone number.", { phone: "Enter a valid phone number" });
  }
}

type ClientInput = z.infer<typeof updateSchema>;

function addressOf(d: ClientInput) {
  const address = { line1: d.addressLine1, line2: d.addressLine2, city: d.city, state: d.state, postalCode: d.postalCode, country: d.country };
  return Object.values(address).some(Boolean) ? address : undefined;
}

/** Client owners must be active employees: interns and trainees never see client data (FRS §3.2). */
async function assertOwner(id: string | undefined) {
  if (!id) return undefined;
  const owner = await User.findById(id, { personType: 1, status: 1 }).lean();
  if (!owner) throw new ActionError("The selected owner no longer exists.");
  if (owner.personType !== "employee" || EXITED_STATUSES.includes(owner.status)) throw new ActionError("Choose an active employee as owner.", { owner: "Choose an active employee" });
  return owner._id;
}

export async function createClient(input: Record<string, unknown>): Promise<ActionResult<ClientSaveResult>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    const data = parse(createSchema, input);
    assertPhones(data.phone, data.altPhone);
    const owner = (await assertOwner(data.owner)) ?? user._id;

    if (!data.confirmDuplicates) {
      const report = await findDuplicates(user, { email: data.email, phone: data.phone, companyName: data.name, includeClients: true });
      if (report.matches.length > 0 || report.restricted > 0) return { duplicates: report };
    }

    const clientNo = await nextNumber("client", ID_PREFIX.client, 4);
    const client = await Client.create({
      clientNo,
      name: data.name,
      type: data.type,
      contactPerson: data.contactPerson,
      contactDesignation: data.contactDesignation,
      email: data.email,
      phone: data.phone,
      altPhone: data.altPhone,
      website: data.website,
      industry: data.industry,
      gstin: data.gstin,
      address: addressOf(data),
      leadSource: data.leadSource,
      owner,
      status: data.status,
      // Only holders of crm.confidential may restrict a client.
      confidential: can(user, "crm.confidential") ? data.confidential : false,
      notes: data.notes,
      createdBy: user._id,
    });
    await audit(user, { action: "create", entity: "client", entityId: client._id, ref: clientNo, summary: `Created client ${client.name} (${clientNo})` });
    await notify([owner], { type: "crm", title: `Client assigned to you: ${client.name}`, body: clientNo, link: `/crm/clients/${client._id}` }, [user._id]);
    return { id: client._id.toString() };
  });
}

export async function updateClient(id: string, input: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    await actionClient(user, id);
    const data = parse(updateSchema, input);
    assertPhones(data.phone, data.altPhone);
    const owner = await assertOwner(data.owner);
    const client = await Client.findById(id);
    if (!client) throw new ActionError("This client no longer exists.");

    const snapshot = () => ({
      name: client.name,
      type: client.type,
      contactPerson: client.contactPerson,
      contactDesignation: client.contactDesignation,
      email: client.email,
      phone: client.phone,
      website: client.website,
      industry: client.industry,
      gstin: client.gstin,
      address: client.address ? JSON.stringify(client.address) : undefined,
      leadSource: client.leadSource,
      owner: client.owner,
      status: client.status,
      confidential: client.confidential,
    });
    const before = snapshot();

    client.name = data.name;
    client.type = data.type;
    client.contactPerson = data.contactPerson;
    client.contactDesignation = data.contactDesignation;
    client.email = data.email;
    client.phone = data.phone;
    client.altPhone = data.altPhone;
    client.website = data.website;
    client.industry = data.industry;
    client.gstin = data.gstin;
    client.address = addressOf(data);
    client.leadSource = data.leadSource;
    client.status = data.status;
    client.notes = data.notes;
    const ownerChanged = owner?.toString() !== client.owner?.toString();
    client.owner = owner;
    if (can(user, "crm.confidential")) client.confidential = data.confidential;
    await client.save();

    // Keep denormalised company names on open leads in step with the client.
    await Lead.updateMany({ client: client._id, status: "open" }, { $set: { companyName: client.name } });
    await audit(user, {
      action: "update",
      entity: "client",
      entityId: client._id,
      ref: client.clientNo,
      summary: `Updated client ${client.name} (${client.clientNo})`,
      // Contact details of a restricted client stay out of the audit trail (FRS §3.2: `audit.view` ≠ `crm.confidential`).
      changes: diff(before, snapshot(), ["name", "type", "contactPerson", "contactDesignation", "email", "phone", "website", "industry", "gstin", "address", "leadSource", "owner", "status", "confidential"], before.confidential || client.confidential ? ["contactPerson", "contactDesignation", "email", "phone", "gstin", "address"] : []),
    });
    if (ownerChanged) {
      await notify([owner], { type: "crm", title: `Client assigned to you: ${client.name}`, body: client.clientNo, link: `/crm/clients/${client._id}` }, [user._id]);
    }
    return { id: client._id.toString() };
  }, "Client updated");
}

export async function deleteClient(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.delete");
    const client = await actionClient(user, id);
    const [proposals, projects, invoices, contracts, leads] = await Promise.all([
      Proposal.countDocuments({ client: client._id }),
      Project.countDocuments({ client: client._id }),
      Invoice.countDocuments({ client: client._id }),
      Contract.countDocuments({ client: client._id }),
      Lead.countDocuments({ client: client._id }),
    ]);
    const linked = [
      proposals && `${proposals} proposal${proposals === 1 ? "" : "s"}`,
      projects && `${projects} project${projects === 1 ? "" : "s"}`,
      invoices && `${invoices} invoice${invoices === 1 ? "" : "s"}`,
      contracts && `${contracts} contract${contracts === 1 ? "" : "s"}`,
      leads && `${leads} lead${leads === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (linked.length > 0) throw new ActionError(`This client can't be deleted because it still has ${linked.join(", ")} linked. Close or remove those first, or set the client to inactive.`);

    await Activity.deleteMany({ client: client._id });
    if (client.attachments.length > 0) {
      await StoredFile.updateMany({ _id: { $in: client.attachments.map((a) => a.file) } }, { $set: { deletedAt: new Date(), deletedBy: user._id } });
    }
    await Client.deleteOne({ _id: client._id });
    await audit(user, { action: "delete", entity: "client", entityId: client._id, ref: client.clientNo, summary: `Deleted client ${client.name} (${client.clientNo})` });
    return null;
  }, "Client deleted");
}

/* ---------------------------------------------------------------- contacts */

const contactSchema = z.object({
  name: zs.text("Name", 200),
  designation: zs.optText(200),
  email: zs.optEmail(),
  phone: zs.optText(40),
});

export async function saveContact(clientId: string, contactId: string | null, input: Record<string, unknown>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    await actionClient(user, clientId);
    const data = parse(contactSchema, input);
    assertPhones(data.phone);
    const client = await Client.findById(clientId);
    if (!client) throw new ActionError("This client no longer exists.");
    if (contactId) {
      const contact = client.contacts.find((c) => c._id?.toString() === contactId);
      if (!contact) throw new ActionError("This contact no longer exists.");
      contact.name = data.name;
      contact.designation = data.designation;
      contact.email = data.email;
      contact.phone = data.phone;
    } else {
      client.contacts.push({ name: data.name, designation: data.designation, email: data.email, phone: data.phone });
    }
    await client.save();
    await audit(user, { action: "update", entity: "client", entityId: client._id, ref: client.clientNo, summary: `${contactId ? "Updated" : "Added"} contact ${data.name} on ${client.clientNo}` });
    return null;
  }, "Contact saved");
}

export async function removeContact(clientId: string, contactId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await actionPermission("crm.manage");
    await actionClient(user, clientId);
    const client = await Client.findById(clientId);
    if (!client) throw new ActionError("This client no longer exists.");
    const contact = client.contacts.find((c) => c._id?.toString() === contactId);
    if (!contact) throw new ActionError("This contact no longer exists.");
    await Client.updateOne({ _id: clientId }, { $pull: { contacts: { _id: contact._id } } });
    await audit(user, { action: "update", entity: "client", entityId: client._id, ref: client.clientNo, summary: `Removed contact ${contact.name} from ${client.clientNo}` });
    return null;
  }, "Contact removed");
}
