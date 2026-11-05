import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Rotating attendance QR codes: `DXA1.<kioskId>.<window>.<sig>`, where `window` counts 15-second periods since the
 * epoch and `sig` is an HMAC over the screen, its salt and the window. Pure helpers (no DB, no request) so they can be tested
 * on their own; the signing secret is passed in.
 */

/** How long each QR code is shown before the screen replaces it. */
export const CODE_WINDOW_MS = 15_000;
/** A code scanned just before the screen rotated is still accepted this long afterwards (network latency). */
export const CODE_GRACE_MS = 5_000;
const PREFIX = "DXA1";
const CODE_PATTERN = /^DXA1\.([0-9a-f]{24})\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/;

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

/** The code's period is the current one, or the previous one scanned within the grace period. */
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
