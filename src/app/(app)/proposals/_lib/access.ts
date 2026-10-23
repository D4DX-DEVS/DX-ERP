import "server-only";
import { forbidden, notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ActionError } from "@/lib/action-result";
import type { CurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Proposal, type IProposal } from "@/lib/models";
import { isObjectId } from "@/lib/validation";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";

type Lookup = { status: "ok"; doc: IProposal } | { status: "missing" } | { status: "forbidden" };

/** Proposals of restricted clients are visible only to people who may see the client, or to the proposal's own owner / creator. */
export async function lookupProposal(user: CurrentUser, id: string): Promise<Lookup> {
  if (!isObjectId(id)) return { status: "missing" };
  const [doc] = await db().select().from(Proposal).where(eq(Proposal._id, id)).limit(1);
  if (!doc) return { status: "missing" };
  const mine = [doc.owner, doc.createdBy].some((p) => p === user.id);
  if (!mine) {
    const [client] = await db().select({ confidential: Client.confidential, owner: Client.owner }).from(Client).where(eq(Client._id, doc.client)).limit(1);
    if (client && !canSeeClient(user, client)) return { status: "forbidden" };
  }
  return { status: "ok", doc };
}

export async function pageProposal(user: CurrentUser, id: string): Promise<IProposal> {
  const r = await lookupProposal(user, id);
  if (r.status === "missing") notFound();
  if (r.status === "forbidden") forbidden();
  return r.doc;
}

export async function actionProposal(user: CurrentUser, id: string): Promise<IProposal> {
  const r = await lookupProposal(user, id);
  if (r.status === "missing") throw new ActionError("This proposal no longer exists.");
  if (r.status === "forbidden") throw new ActionError("You don't have access to this proposal.");
  return r.doc;
}
