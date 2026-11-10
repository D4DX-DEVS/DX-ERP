import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Signed links that open one document without signing in (an invoice PDF sent to a client over WhatsApp, say):
 * `<id>.<expiry day>.<sig>`, where the HMAC covers the kind of document, its id and the expiry. Nothing is stored, so a
 * link stays valid until it expires; rotating AUTH_SECRET revokes every link at once.
 */
const DAY_MS = 86_400_000;
/** A link works for at least this many days from when it was copied. */
export const SHARE_LINK_DAYS = 30;
const TOKEN = /^([0-9a-f]{24})\.(\d{5,6})\.([A-Za-z0-9_-]{32})$/;

function signature(kind: string, id: string, expiryDay: number): string {
  return createHmac("sha256", env.authSecret).update(`share|${kind}|${id}|${expiryDay}`).digest("base64url").slice(0, 32);
}

/** Token for `id`, valid until the end of the day SHARE_LINK_DAYS from now (the same link all day, so it can be cached). */
export function shareToken(kind: string, id: string): string {
  const expiryDay = Math.floor(Date.now() / DAY_MS) + SHARE_LINK_DAYS;
  return `${id}.${expiryDay}.${signature(kind, id, expiryDay)}`;
}

/** The document id the token was issued for, or null when it is malformed, forged or expired. */
export function verifyShareToken(kind: string, token: string): string | null {
  const m = TOKEN.exec(token);
  if (!m) return null;
  const [, id, day, sig] = m;
  const expiryDay = Number(day);
  if (Math.floor(Date.now() / DAY_MS) > expiryDay) return null;
  const expected = Buffer.from(signature(kind, id, expiryDay));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** Public link to an invoice PDF. */
export function invoiceShareUrl(id: string): string {
  return `${env.appUrl}/api/share/invoice/${shareToken("invoice", id)}`;
}
