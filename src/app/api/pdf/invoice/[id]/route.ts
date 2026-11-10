import { eq } from "drizzle-orm";
import { can, getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Client, Invoice } from "@/lib/models";
import { isObjectId } from "@/lib/validation";
import { pdfResponse } from "@/lib/pdf/base";
import { invoicePdf } from "@/app/(app)/invoices/invoice-pdf";
import { canSeeClient } from "@/app/(app)/crm/_lib/access";

/** GET /api/pdf/invoice/<id> — invoice PDF (requires `invoices.view`). */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  if (!can(user, "invoices.view")) return new Response("You don't have access to invoices.", { status: 403 });
  const { id } = await ctx.params;
  if (!isObjectId(id)) return new Response("Not found", { status: 404 });

  const [inv] = await db().select().from(Invoice).where(eq(Invoice._id, id)).limit(1);
  if (!inv) return new Response("Not found", { status: 404 });
  const [client] = await db().select({ confidential: Client.confidential, owner: Client.owner }).from(Client).where(eq(Client._id, inv.client)).limit(1);
  if (client && !canSeeClient(user, client)) return new Response("You don't have access to this client.", { status: 403 });

  const { doc, filename } = await invoicePdf(inv, { showContract: can(user, "contracts.view") });
  return pdfResponse(doc, filename);
}
