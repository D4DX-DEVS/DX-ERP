import "server-only";
import type { Types } from "mongoose";
import { forbidden, notFound } from "next/navigation";
import { ActionError } from "@/lib/action-result";
import { can, type CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Lead, type IClient, type ILead } from "@/lib/models";
import { isObjectId } from "@/lib/validation";

/**
 * Restricted client information (FRS §3.2): a confidential client — and everything hanging off it
 * (leads, activities, attachments, proposals, contracts) — is visible only to holders of
 * `crm.confidential` and to the client's owner.
 */
export function canSeeClient(user: CurrentUser, client: Pick<IClient, "confidential" | "owner">): boolean {
  if (!client.confidential) return true;
  return can(user, "crm.confidential") || client.owner?.toString() === user.id;
}

/** Ids of confidential clients this user may not see (always empty for `crm.confidential` holders). */
export async function hiddenClientIds(user: CurrentUser): Promise<Types.ObjectId[]> {
  if (can(user, "crm.confidential")) return [];
  await connectDB();
  const rows = await Client.find({ confidential: true, owner: { $ne: user._id } }, { _id: 1 }).lean();
  return rows.map((r) => r._id);
}

/** Filter fragment for collections that carry a `client` field (leads, proposals, contracts, projects…). */
export function notHiddenClient(hidden: Types.ObjectId[]): Record<string, unknown> {
  return hidden.length ? { client: { $nin: hidden } } : {};
}

/**
 * Filter fragment for proposals / contracts: records of hidden clients are excluded unless the user
 * created or owns the record themself.
 */
export function recordScope(hidden: Types.ObjectId[], user: CurrentUser, ownerFields: string[]): Record<string, unknown> {
  if (hidden.length === 0) return {};
  return { $or: [{ client: { $nin: hidden } }, ...ownerFields.map((f) => ({ [f]: user._id }))] };
}

/** Filter for the Client collection itself. */
export function clientScope(user: CurrentUser): Record<string, unknown> {
  if (can(user, "crm.confidential")) return {};
  return { $or: [{ confidential: { $ne: true } }, { owner: user._id }] };
}

type Lookup<T> = { status: "ok"; doc: T } | { status: "missing" } | { status: "forbidden" };

export async function lookupClient(user: CurrentUser, id: string): Promise<Lookup<IClient>> {
  if (!isObjectId(id)) return { status: "missing" };
  await connectDB();
  const doc = await Client.findById(id).lean();
  if (!doc) return { status: "missing" };
  return canSeeClient(user, doc) ? { status: "ok", doc } : { status: "forbidden" };
}

export async function lookupLead(user: CurrentUser, id: string): Promise<Lookup<ILead>> {
  if (!isObjectId(id)) return { status: "missing" };
  await connectDB();
  const doc = await Lead.findById(id).lean();
  if (!doc) return { status: "missing" };
  if (doc.client) {
    const client = await Client.findById(doc.client, { confidential: 1, owner: 1 }).lean();
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
export function canSeeContractSecrets(user: CurrentUser, contract: { confidential: boolean; createdBy?: Types.ObjectId }): boolean {
  if (!contract.confidential) return true;
  return can(user, "contracts.manage") || can(user, "crm.confidential") || contract.createdBy?.toString() === user.id;
}
