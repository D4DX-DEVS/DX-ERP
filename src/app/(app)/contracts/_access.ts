import "server-only";
import { forbidden, notFound } from "next/navigation";
import { ActionError } from "@/lib/action-result";
import type { CurrentUser } from "@/lib/auth/session";
import { connectDB } from "@/lib/db";
import { Client, Contract, type IContract } from "@/lib/models";
import { isObjectId } from "@/lib/validation";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";

type Lookup = { status: "ok"; doc: IContract } | { status: "missing" } | { status: "forbidden" };

/** A contract of a restricted client is visible to people who may see the client, or to its creator. */
export async function lookupContract(user: CurrentUser, id: string): Promise<Lookup> {
  if (!isObjectId(id)) return { status: "missing" };
  await connectDB();
  const doc = await Contract.findById(id).lean();
  if (!doc) return { status: "missing" };
  if (doc.createdBy?.toString() !== user.id) {
    const client = await Client.findById(doc.client, { confidential: 1, owner: 1 }).lean();
    if (client && !canSeeClient(user, client)) return { status: "forbidden" };
  }
  return { status: "ok", doc };
}

export async function pageContract(user: CurrentUser, id: string): Promise<IContract> {
  const r = await lookupContract(user, id);
  if (r.status === "missing") notFound();
  if (r.status === "forbidden") forbidden();
  return r.doc;
}

export async function actionContract(user: CurrentUser, id: string): Promise<IContract> {
  const r = await lookupContract(user, id);
  if (r.status === "missing") throw new ActionError("This contract no longer exists.");
  if (r.status === "forbidden") throw new ActionError("You don't have access to this contract.");
  return r.doc;
}
