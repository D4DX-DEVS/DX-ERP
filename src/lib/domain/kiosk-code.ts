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
 * address). IPv4-mapped IPv6 counts as IPv4. Null when the value is not an IP.
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
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** Adds a sighting of the screen's network (newest first, distinct, at most five). */
export function withNetwork(networks: KioskNetwork[], net: string | null, at: Date): KioskNetwork[] {
  if (!net) return networks;
  return [{ net, at }, ...networks.filter((n) => n.net !== net)].slice(0, MAX_NETWORKS);
}
