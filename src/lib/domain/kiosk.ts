import "server-only";
import { and, desc, eq, gte, lt, or } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { ActionError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth/session";
import { KIOSK_COOKIE, signToken, verifyToken } from "@/lib/auth/token";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AttendanceKiosk, AuditLog, KioskLanSignal, type IAttendanceKiosk } from "@/lib/models";
import { DIRECT_ORIGIN_HEADER, PROXY_HOSTS } from "@/lib/proxy-hosts";
import { lanProofValid, networkOf, parseKioskCode, readNetworkToken, sigMatches, windowAccepted } from "./kiosk-code";

const KIOSK_AUDIENCE = "kiosk";
/** Tokens for the local Wi-Fi handshake calls, made straight to the Worker's own host (no cookies there). */
const HUB_AUDIENCE = "kiosk-hub";
const LAN_POLL_AUDIENCE = "lan-poll";
const HUB_TOKEN_MS = 10 * 60_000;
const LAN_POLL_TOKEN_MS = 60_000;
const MAX_SDP = 12_000;
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

/** The screen behind a scanned code that is genuine and current; throws a message for the person otherwise. */
async function scannedKiosk(code: unknown, action: "check in" | "check out") {
  const input = codeSchema.safeParse(code);
  if (!input.success) throw new ActionError(`Scan the QR code on the office attendance screen to ${action}.`);
  const parsed = parseKioskCode(input.data);
  if (!parsed) throw new ActionError("This isn't the office attendance QR code.");
  if (!windowAccepted(parsed.window, Date.now())) throw new ActionError("This QR code has expired. Scan the code on the screen now.");
  const [kiosk] = await db()
    .select({ _id: AttendanceKiosk._id, name: AttendanceKiosk.name, codeSalt: AttendanceKiosk.codeSalt, deviceId: AttendanceKiosk.deviceId, networks: AttendanceKiosk.networks })
    .from(AttendanceKiosk)
    .where(eq(AttendanceKiosk._id, parsed.kioskId))
    .limit(1);
  if (!kiosk?.deviceId || !sigMatches(env.authSecret, kiosk, parsed)) throw new ActionError("This QR code is no longer valid. Scan the code on the office screen.");
  return kiosk;
}

/**
 * Evidence the phone is on the office network: `lan`, the secret the screen passed over the local Wi-Fi handshake,
 * and `network`, a token from /api/kiosk/network. A bare string is a network token (pages from before the handshake).
 */
export type ScanProof = { network?: unknown; lan?: unknown };

function asProof(proof: unknown): ScanProof {
  if (typeof proof === "string") return { network: proof };
  return proof && typeof proof === "object" ? (proof as ScanProof) : {};
}

/**
 * With QR check-in on, a check-in / check-out needs a code scanned from an office screen within its minute.
 * Returns the screen's name, or null when QR check-in is off.
 */
export async function requireKioskScan(
  settings: AppSettings,
  code: unknown,
  rawProof: unknown,
  action: "check in" | "check out",
  user: Pick<CurrentUser, "_id" | "name" | "role">,
): Promise<string | null> {
  if (!settings.attendance.qrCheckIn) return null;
  const kiosk = await scannedKiosk(code, action);
  const now = Date.now();
  if (settings.attendance.qrSameNetwork) {
    const proof = asProof(rawProof);
    // The phone reached the screen directly over the local network: same Wi-Fi, whatever IPv4 / IPv6 it uses.
    if (lanProofValid(env.authSecret, kiosk, proof.lan, now)) return kiosk.name;
    // Otherwise (Wi-Fi that keeps devices apart) compare internet addresses. Fails closed: unknown never passes.
    const net = await provenNetwork(proof.network);
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

/** CORS headers for the direct-host endpoints, readable only by the app's own pages. */
export function directCors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const self = new URL(request.url).origin;
  const allowed = new Set([self, new URL(env.appUrl).origin, ...PROXY_HOSTS.map((h) => `https://${h}`)]);
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** Access token a screen uses for handshake calls to the direct host (renewed with every code poll). */
export async function hubToken(kioskId: string): Promise<string> {
  return signToken({ kid: kioskId }, new Date(Date.now() + HUB_TOKEN_MS), HUB_AUDIENCE);
}

export async function kioskFromHubToken(token: string | null): Promise<string | null> {
  return (await verifyToken<{ kid: string }>(token ?? undefined, HUB_AUDIENCE))?.kid ?? null;
}

export async function signalFromPollToken(token: string | null): Promise<string | null> {
  return (await verifyToken<{ sid: string }>(token ?? undefined, LAN_POLL_AUDIENCE))?.sid ?? null;
}

/**
 * Phone side of the handshake: records its WebRTC offer for the screen behind the scanned code, replacing the
 * person's previous one and clearing old rows. Returns the row and a token to poll for the screen's answer.
 */
export async function startLanSignal(code: unknown, sdp: unknown, user: Pick<CurrentUser, "_id">, action: "check in" | "check out") {
  const kiosk = await scannedKiosk(code, action);
  if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > MAX_SDP) throw new ActionError("The Wi-Fi check could not start.");
  await db()
    .delete(KioskLanSignal)
    .where(or(eq(KioskLanSignal.user, user._id), lt(KioskLanSignal.createdAt, new Date(Date.now() - 5 * 60_000))));
  const [row] = await db().insert(KioskLanSignal).values({ kiosk: kiosk._id, user: user._id, offer: sdp }).returning({ id: KioskLanSignal._id });
  return { id: row.id, token: await signToken({ sid: row.id }, new Date(Date.now() + LAN_POLL_TOKEN_MS), LAN_POLL_AUDIENCE) };
}
