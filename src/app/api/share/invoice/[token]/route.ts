import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { Invoice } from "@/lib/models";
import { pdfResponse } from "@/lib/pdf/base";
import { verifyShareToken } from "@/lib/share-link";
import { invoicePdf } from "@/app/(app)/invoices/invoice-pdf";

/**
 * GET /api/share/invoice/<token> — the invoice PDF for whoever holds a signed share link (sent to the client by WhatsApp
 * or copied from the invoice page). No sign-in: the token names the invoice and expires (lib/share-link.ts).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const id = verifyShareToken("invoice", token);
  if (!id) return new Response("This link is invalid or has expired. Please ask for a new one.", { status: 404 });
  const [inv] = await db().select().from(Invoice).where(eq(Invoice._id, id)).limit(1);
  // Drafts are never shared; a deleted invoice is simply gone.
  if (!inv || inv.status === "draft") return new Response("This invoice is no longer available.", { status: 404 });
  const { doc, filename } = await invoicePdf(inv, { showContract: true });
  return pdfResponse(doc, filename);
}
