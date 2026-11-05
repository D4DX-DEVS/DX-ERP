import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { KioskNetwork } from "@/lib/models/attendance";

/**
 * Rotating attendance QR codes: `DXA1.<kioskId>.<window>.<sig>`, where `window` is the minute since the epoch and
 * `sig` an HMAC over the screen, its salt and the window. Pure helpers (no DB, no request) so they can be tested
 * on their own; the signing secret is passed in.
 */

export const CODE_WINDOW_MS = 60_000;
/** A code scanned just before the screen rotated is still accepted this long afterwards (network latency). */
export const CODE_GRACE_MS = 10_000;
const PREFIX = "DXA1";
const CODE_PATTERN = /^DXA1\.([0-9a-f]{24})\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/;
const MAX_NETWORKS = 5;
/** A network token proves the caller's network for this long. */
export const NETWORK_TOKEN_MS = 2 * 60_000;
/** Source address of requests forwarded by another Cloudflare Worker (the erp.d4dx.co proxy) — never a client's. */
const WORKER_EGRESS_PREFIX = "2a06:98c0:3600:";

export interface KioskCodeKey {
  _id: string;
  codeSalt: string;
}

export interface ParsedKioskCode {
  kioskId: string;
  window: number;
  sig: string;
}

export function codeWindow(now: number): number {
  return Math.floor(now / CODE_WINDOW_MS);
}

function signature(secret: string, kiosk: KioskCodeKey, window: number): string {
  return createHmac("sha256", secret).update(`kiosk|${kiosk._id}|${kiosk.codeSalt}|${window}`).digest("base64url").slice(0, 22);
}

/** The code a screen shows at `now`, and when it stops being the current one. */
export function kioskCodeFor(secret: string, kiosk: KioskCodeKey, now: number): { code: string; expiresAt: number } {
  const window = codeWindow(now);
  return { code: `${PREFIX}.${kiosk._id}.${window}.${signature(secret, kiosk, window)}`, expiresAt: (window + 1) * CODE_WINDOW_MS };
}

export function parseKioskCode(code: string): ParsedKioskCode | null {
  const m = CODE_PATTERN.exec(code.trim());
  return m ? { kioskId: m[1], window: Number(m[2]), sig: m[3] } : null;
}

/** The code's minute is the current one, or the previous one scanned within the grace period. */
export function windowAccepted(window: number, now: number): boolean {
  const current = codeWindow(now);
  if (window === current) return true;
  return window === current - 1 && now - current * CODE_WINDOW_MS <= CODE_GRACE_MS;
}

export function sigMatches(secret: string, kiosk: KioskCodeKey, parsed: ParsedKioskCode): boolean {
  const expected = Buffer.from(signature(secret, kiosk, parsed.window));
  const given = Buffer.from(parsed.sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Screen link token (256 bits); only its hash is stored. */
export function newKioskToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newCodeSalt(): string {
  return randomBytes(16).toString("base64url");
}

export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Network of a client IP: IPv4 as-is, IPv6 as its /64 prefix (devices on one LAN share it, each with its own
 * address). IPv4-mapped IPv6 counts as IPv4. Null when the value is not an IP, or is a Cloudflare Worker's
 * forwarding address.
 */
export function networkOf(ip: string | null | undefined): string | null {
  const value = ip?.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!value) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)?.[1];
  if (v4) return v4.split(".").every((o) => Number(o) <= 255) ? v4 : null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const net = `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
  return net.startsWith(WORKER_EGRESS_PREFIX) ? null : net;
}

/** A network as `networkOf` writes it ("1.2.3.4", "2401:4900:8824:c80a::/64" or any IPv6 address), normalised. */
export function parseNetwork(text: string): string | null {
  const t = text.trim().toLowerCase();
  return t.endsWith("::/64") ? networkOf(`${t.slice(0, -3)}1`) : networkOf(t);
}

/** Adds a sighting of the screen's network (newest first, distinct, at most five; proxy addresses dropped). */
export function withNetwork(networks: KioskNetwork[], net: string | null, at: Date): KioskNetwork[] {
  const kept = networks.filter((n) => n.net !== net && !n.net.startsWith(WORKER_EGRESS_PREFIX));
  return (net ? [{ net, at }, ...kept] : kept).slice(0, MAX_NETWORKS);
}

function networkSignature(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`network|${payload}`).digest("base64url").slice(0, 22);
}

/**
 * Signed proof of a caller's network, issued where the Worker sees the real client address (its direct host).
 * Lets requests that arrive through the erp.d4dx.co proxy — which hides that address — still be checked.
 */
export function signNetworkToken(secret: string, net: string, now: number): string {
  const payload = Buffer.from(`${net}|${now + NETWORK_TOKEN_MS}`).toString("base64url");
  return `${payload}.${networkSignature(secret, payload)}`;
}

/** The network a token proves, or null when it is missing, forged or expired. */
export function readNetworkToken(secret: string, token: unknown, now: number): string | null {
  if (typeof token !== "string" || token.length > 300) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(networkSignature(secret, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [net, expires] = Buffer.from(payload, "base64url").toString().split("|");
  return net && Number(expires) >= now ? net : null;
}

function lanSignature(secret: string, kiosk: KioskCodeKey, window: number): string {
  return createHmac("sha256", secret).update(`lan|${kiosk._id}|${kiosk.codeSalt}|${window}`).digest("base64url").slice(0, 22);
}

/**
 * Secret a QR screen hands to phones over the local Wi-Fi handshake (`window.sig`, changes every minute). Never
 * shown in the QR, so holding it shows the phone reached the screen directly on the local network.
 */
export function lanProofFor(secret: string, kiosk: KioskCodeKey, now: number): string {
  const window = codeWindow(now);
  return `${window}.${lanSignature(secret, kiosk, window)}`;
}

/** The proof is this screen's, from this minute or the previous one. */
export function lanProofValid(secret: string, kiosk: KioskCodeKey, proof: unknown, now: number): boolean {
  if (typeof proof !== "string") return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{22})$/.exec(proof);
  if (!m) return false;
  const window = Number(m[1]);
  const current = codeWindow(now);
  if (window !== current && window !== current - 1) return false;
  const expected = Buffer.from(lanSignature(secret, kiosk, window));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
