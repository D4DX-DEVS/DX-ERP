import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { KIOSK_COOKIE } from "@/lib/auth/token";
import { db } from "@/lib/db";
import { hubToken, KIOSK_COOKIE_RENEW_SECONDS, kioskCookie, kioskFromCookie, provenNetwork } from "@/lib/domain/kiosk";
import { kioskCodeFor, lanProofFor, withNetwork } from "@/lib/domain/kiosk-code";
import { env } from "@/lib/env";
import { AttendanceKiosk } from "@/lib/models";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Current QR code of the office attendance screen bound to this browser (polled once a minute by /kiosk/[token],
 * with `?network=` a token from /api/kiosk/network). `build` changes with every deploy, so the screen reloads.
 * `lan` is the secret the screen passes to phones over the local Wi-Fi handshake, `hub` its token for that.
 */
export async function GET(request: NextRequest) {
  const found = await kioskFromCookie(request.cookies.get(KIOSK_COOKIE)?.value);
  if (!found) {
    return NextResponse.json(
      { error: "This screen is no longer connected. The link was renewed or the screen was removed — open the current link from Settings → Attendance." },
      { status: 401, headers: NO_STORE },
    );
  }
  const { kiosk, claims } = found;
  const now = new Date();
  // Keeps "last seen" and the screen's networks fresh for the same-network rule.
  await db()
    .update(AttendanceKiosk)
    .set({ lastSeenAt: now, networks: withNetwork(kiosk.networks, await provenNetwork(request.nextUrl.searchParams.get("network")), now) })
    .where(and(eq(AttendanceKiosk._id, kiosk._id), eq(AttendanceKiosk.deviceId, claims.did)));

  const { code, expiresAt } = kioskCodeFor(env.authSecret, kiosk, now.getTime());
  const response = NextResponse.json(
    {
      name: kiosk.name,
      code,
      expiresAt,
      serverNow: now.getTime(),
      build: process.env.APP_BUILD_ID ?? "dev",
      lan: lanProofFor(env.authSecret, kiosk, now.getTime()),
      hub: await hubToken(kiosk._id),
    },
    { headers: NO_STORE },
  );
  if (!claims.iat || now.getTime() / 1000 - claims.iat > KIOSK_COOKIE_RENEW_SECONDS) {
    const cookie = await kioskCookie(kiosk._id, claims.did);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}
