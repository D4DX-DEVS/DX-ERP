import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { ActionError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { KIOSK_COOKIE, signToken, verifyToken } from "@/lib/auth/token";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AttendanceKiosk, AuditLog, type IAttendanceKiosk } from "@/lib/models";
import { DIRECT_ORIGIN_HEADER } from "@/lib/proxy-hosts";
import { networkOf, parseKioskCode, readNetworkToken, sigMatches, windowAccepted } from "./kiosk-code";

const KIOSK_AUDIENCE = "kiosk";
/** Chrome caps cookie lifetimes at 400 days; the code endpoint renews the cookie weekly. */
const KIOSK_COOKIE_DAYS = 400;
export const KIOSK_COOKIE_RENEW_SECONDS = 7 * 86_400;
/** With the same-network rule, a screen's network counts for this long after it was last seen. */
const NETWORK_TTL_MS = 24 * 3_600_000;

type KioskClaims = { kid: string; did: string; iat?: number };

/** Audit entity of scans refused by the same-network rule; Settings lists their networks so admins can allow one. */
const SCAN_REFUSED_ENTITY = "attendance_scan";

/**
 * Network of the current request's client (Cloudflare's connecting IP first). Null when unknown — in particular
 * for requests forwarded by another Worker (the erp.d4dx.co proxy), which carry the proxy's address instead.
 */
export async function clientNetwork(): Promise<string | null> {
  const h = await headers();
  if (h.get("cf-worker")) return null;
  return networkOf(h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]);
}

/**
 * Where pages fetch a network token (`/api/kiosk/network`): the Worker's direct host when reached through a proxy.
 * Worked out by `proxy.ts`, which still sees the Worker's own host (pages see the proxy's).
 */
export async function networkCheckOrigin(): Promise<string> {
  return (await headers()).get(DIRECT_ORIGIN_HEADER) ?? "";
}

/** Network proven by a token from `/api/kiosk/network`, else the request's own (when not proxied). */
export async function provenNetwork(token: unknown): Promise<string | null> {
  return readNetworkToken(env.authSecret, token, Date.now()) ?? (await clientNetwork());
}

/** Signed cookie that binds a screen to the browser that activated it. */
export async function kioskCookie(kioskId: string, deviceId: string) {
  const expires = new Date(Date.now() + KIOSK_COOKIE_DAYS * 86_400_000);
  const value = await signToken({ kid: kioskId, did: deviceId }, expires, KIOSK_AUDIENCE);
  return { name: KIOSK_COOKIE, value, options: { httpOnly: true, secure: env.isProduction, sameSite: "lax" as const, path: "/", expires } };
}

/** The activated screen behind a kiosk cookie; null when the cookie is invalid, the screen deleted or its link renewed. */
export async function kioskFromCookie(token: string | undefined): Promise<{ kiosk: IAttendanceKiosk; claims: KioskClaims } | null> {
  const claims = await verifyToken<KioskClaims>(token, KIOSK_AUDIENCE);
  if (!claims?.kid || !claims.did) return null;
  const [kiosk] = await db().select().from(AttendanceKiosk).where(eq(AttendanceKiosk._id, claims.kid)).limit(1);
  if (!kiosk?.deviceId || kiosk.deviceId !== claims.did) return null;
  return { kiosk, claims };
}

const codeSchema = z.string().trim().min(1).max(200);

/**
 * With QR check-in on, a check-in / check-out needs a code scanned from an office screen within its minute.
 * Returns the screen's name, or null when QR check-in is off.
 */
export async function requireKioskScan(
  settings: AppSettings,
  code: unknown,
  network: unknown,
  action: "check in" | "check out",
  user: Pick<CurrentUser, "_id" | "name" | "role">,
): Promise<string | null> {
  if (!settings.attendance.qrCheckIn) return null;
  const input = codeSchema.safeParse(code);
  if (!input.success) throw new ActionError(`Scan the QR code on the office attendance screen to ${action}.`);
  const parsed = parseKioskCode(input.data);
  if (!parsed) throw new ActionError("This isn't the office attendance QR code.");
  const now = Date.now();
  if (!windowAccepted(parsed.window, now)) throw new ActionError("This QR code has expired. Scan the code on the screen now.");
  const [kiosk] = await db()
    .select({ _id: AttendanceKiosk._id, name: AttendanceKiosk.name, codeSalt: AttendanceKiosk.codeSalt, deviceId: AttendanceKiosk.deviceId, networks: AttendanceKiosk.networks })
    .from(AttendanceKiosk)
    .where(eq(AttendanceKiosk._id, parsed.kioskId))
    .limit(1);
  if (!kiosk?.deviceId || !sigMatches(env.authSecret, kiosk, parsed)) throw new ActionError("This QR code is no longer valid. Scan the code on the office screen.");
  if (settings.attendance.qrSameNetwork) {
    // Fails closed: an unknown network never passes.
    const net = await provenNetwork(network);
    if (!net) throw new ActionError("Your phone's network couldn't be checked. Reload the page and scan again.");
    // The screen's own recent networks, plus office networks an admin allowed (e.g. the Wi-Fi's IPv6 when the
    // screen computer only reports IPv4).
    const allowed = new Set([...kiosk.networks.filter((n) => now - n.at.getTime() <= NETWORK_TTL_MS).map((n) => n.net), ...settings.attendance.qrOfficeNetworks]);
    if (!allowed.size) throw new ActionError(`The office screen "${kiosk.name}" hasn't reported its network yet. Ask an admin to reload it.`);
    if (!allowed.has(net)) {
      await audit(user, { action: "reject", entity: SCAN_REFUSED_ENTITY, entityId: kiosk._id, ref: net, summary: `QR ${action} refused at "${kiosk.name}": network ${net} is not an office network` });
      throw new ActionError(`Connect your phone to the office Wi-Fi and scan again. (This phone's network: ${net}. If you are on the office Wi-Fi, an admin can allow it in Settings → Attendance.)`);
    }
  }
  return kiosk.name;
}

/** A screen polls once a minute; one not heard from for this long is shown as offline. */
const ONLINE_WITHIN_MS = 3 * 60_000;

/** Status chip of a screen for the settings list. */
export function kioskStatus(kiosk: Pick<IAttendanceKiosk, "deviceId" | "lastSeenAt">): { label: string; tone: "green" | "amber" | "gray" } {
  if (!kiosk.deviceId) return { label: "Waiting to be opened", tone: "gray" };
  const online = kiosk.lastSeenAt && Date.now() - kiosk.lastSeenAt.getTime() <= ONLINE_WITHIN_MS;
  return online ? { label: "Showing QR", tone: "green" } : { label: "Offline", tone: "amber" };
}

export interface ScanRefusal {
  net: string;
  count: number;
  last: Date;
  names: string[];
}

/** Networks scans were refused from in the last 7 days, most recent first, for admins to allow the office's own. */
export async function recentScanRefusals(): Promise<ScanRefusal[]> {
  const rows = await db()
    .select({ net: AuditLog.ref, name: AuditLog.actorName, at: AuditLog.at })
    .from(AuditLog)
    .where(and(eq(AuditLog.entity, SCAN_REFUSED_ENTITY), gte(AuditLog.at, new Date(Date.now() - 7 * 86_400_000))))
    .orderBy(desc(AuditLog.at))
    .limit(200);
  const byNet = new Map<string, ScanRefusal>();
  for (const r of rows) {
    if (!r.net) continue;
    const entry = byNet.get(r.net) ?? { net: r.net, count: 0, last: r.at, names: [] };
    entry.count++;
    if (entry.names.length < 3 && !entry.names.includes(r.name)) entry.names.push(r.name);
    byNet.set(r.net, entry);
  }
  return [...byNet.values()];
}
