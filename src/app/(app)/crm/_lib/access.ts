import "server-only";
import { forbidden, notFound } from "next/navigation";
import { and, eq, isNull, ne, or, type Column, type SQL } from "drizzle-orm";
import { ActionError } from "@/lib/action-result";
import { can, type CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Lead, type Id, type IClient, type ILead } from "@/lib/models";
import { notInList } from "@/lib/sql";
import { isObjectId } from "@/lib/validation";

/**
 * Restricted client information (FRS §3.2): a confidential client — and everything hanging off it
 * (leads, activities, attachments, proposals, contracts) — is visible only to holders of
 * `crm.confidential` and to the client's owner.
 */
export function canSeeClient(user: CurrentUser, client: { confidential?: boolean | null; owner?: Id | null }): boolean {
  if (!client.confidential) return true;
  return can(user, "crm.confidential") || client.owner === user.id;
}

/** Ids of confidential clients this user may not see (always empty for `crm.confidential` holders). */
export async function hiddenClientIds(user: CurrentUser): Promise<Id[]> {
  if (can(user, "crm.confidential")) return [];
  const rows = await db()
    .select({ id: Client._id })
    .from(Client)
    .where(and(eq(Client.confidential, true), or(isNull(Client.owner), ne(Client.owner, user._id))));
  return rows.map((r) => r.id);
}

/** Condition for tables that carry a client reference (`clientColumn`: leads, proposals, contracts, projects, invoices…). */
export function notHiddenClient(hidden: Id[], clientColumn: Column): SQL | undefined {
  return hidden.length ? notInList(clientColumn, hidden) : undefined;
}

/**
 * Condition for proposals / contracts: records of hidden clients are excluded unless the user
 * created or owns the record themself (`ownerColumns`, e.g. `Contract.createdBy`).
 */
export function recordScope(hidden: Id[], user: CurrentUser, clientColumn: Column, ownerColumns: Column[]): SQL | undefined {
  if (hidden.length === 0) return undefined;
  return or(notInList(clientColumn, hidden), ...ownerColumns.map((c) => eq(c, user._id)));
}

/** Condition for the Client table itself. */
export function clientScope(user: CurrentUser): SQL | undefined {
  if (can(user, "crm.confidential")) return undefined;
  return or(ne(Client.confidential, true), eq(Client.owner, user._id));
}

type Lookup<T> = { status: "ok"; doc: T } | { status: "missing" } | { status: "forbidden" };

export async function lookupClient(user: CurrentUser, id: string): Promise<Lookup<IClient>> {
  if (!isObjectId(id)) return { status: "missing" };
  const [doc] = await db().select().from(Client).where(eq(Client._id, id)).limit(1);
  if (!doc) return { status: "missing" };
  return canSeeClient(user, doc) ? { status: "ok", doc } : { status: "forbidden" };
}

export async function lookupLead(user: CurrentUser, id: string): Promise<Lookup<ILead>> {
  if (!isObjectId(id)) return { status: "missing" };
  const [doc] = await db().select().from(Lead).where(eq(Lead._id, id)).limit(1);
  if (!doc) return { status: "missing" };
  if (doc.client) {
    const [client] = await db().select({ confidential: Client.confidential, owner: Client.owner }).from(Client).where(eq(Client._id, doc.client)).limit(1);
    if (client && !canSeeClient(user, client)) return { status: "forbidden" };
  }
  return { status: "ok", doc };
}

/** Page helpers: 404 / 403 through Next.js. */
export async function pageClient(user: CurrentUser, id: string): Promise<IClient> {
  const r = await lookupClient(user, id);
  if (r.status === "missing") notFound();
  if (r.status === "forbidden") forbidden();
  return r.doc;
}

export async function pageLead(user: CurrentUser, id: string): Promise<ILead> {
  const r = await lookupLead(user, id);
  if (r.status === "missing") notFound();
  if (r.status === "forbidden") forbidden();
  return r.doc;
}

/** Action helpers: readable errors instead of control-flow exceptions. */
export async function actionClient(user: CurrentUser, id: string): Promise<IClient> {
  const r = await lookupClient(user, id);
  if (r.status === "missing") throw new ActionError("This client no longer exists.");
  if (r.status === "forbidden") throw new ActionError("You don't have access to this client.");
  return r.doc;
}

export async function actionLead(user: CurrentUser, id: string): Promise<ILead> {
  const r = await lookupLead(user, id);
  if (r.status === "missing") throw new ActionError("This lead no longer exists.");
  if (r.status === "forbidden") throw new ActionError("You don't have access to this lead.");
  return r.doc;
}

/**
 * Confidential contracts hide their value and files unless the user manages contracts, holds
 * `crm.confidential`, or created the contract.
 */
export function canSeeContractSecrets(user: CurrentUser, contract: { confidential: boolean; createdBy?: Id | null }): boolean {
  if (!contract.confidential) return true;
  return can(user, "contracts.manage") || can(user, "crm.confidential") || contract.createdBy === user.id;
}
