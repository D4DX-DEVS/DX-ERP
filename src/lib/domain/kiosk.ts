import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { ActionError } from "@/lib/actions";
import { KIOSK_COOKIE, signToken, verifyToken } from "@/lib/auth/token";
import type { AppSettings } from "@/lib/config-defaults";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AttendanceKiosk, type IAttendanceKiosk } from "@/lib/models";
import { networkOf, parseKioskCode, sigMatches, windowAccepted } from "./kiosk-code";

const KIOSK_AUDIENCE = "kiosk";
/** Chrome caps cookie lifetimes at 400 days; the code endpoint renews the cookie weekly. */
const KIOSK_COOKIE_DAYS = 400;
export const KIOSK_COOKIE_RENEW_SECONDS = 7 * 86_400;
/** With the same-network rule, a screen's network counts for this long after it was last seen. */
const NETWORK_TTL_MS = 24 * 3_600_000;

type KioskClaims = { kid: string; did: string; iat?: number };

/** Network of the current request's client (Cloudflare's connecting IP first). */
export async function clientNetwork(): Promise<string | null> {
  const h = await headers();
  return networkOf(h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]);
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
export async function requireKioskScan(settings: AppSettings, code: unknown, action: "check in" | "check out"): Promise<string | null> {
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
    const net = await clientNetwork();
    const onNetwork = net && kiosk.networks.some((n) => n.net === net && now - n.at.getTime() <= NETWORK_TTL_MS);
    if (!onNetwork) throw new ActionError("Connect your phone to the office Wi-Fi and scan again.");
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
