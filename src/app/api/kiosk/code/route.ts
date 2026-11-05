import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { KIOSK_COOKIE } from "@/lib/auth/token";
import { db } from "@/lib/db";
import { KIOSK_COOKIE_RENEW_SECONDS, kioskCookie, kioskFromCookie } from "@/lib/domain/kiosk";
import { CODE_WINDOW_MS, kioskCodeFor } from "@/lib/domain/kiosk-code";
import { env } from "@/lib/env";
import { AttendanceKiosk } from "@/lib/models";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Current QR code of the office attendance screen bound to this browser (polled by /kiosk/[token] each time the
 * code rotates, every `period` ms). `build` changes with every deploy, so the screen reloads itself.
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
  await db()
    .update(AttendanceKiosk)
    .set({ lastSeenAt: now })
    .where(and(eq(AttendanceKiosk._id, kiosk._id), eq(AttendanceKiosk.deviceId, claims.did)));

  const { code, expiresAt } = kioskCodeFor(env.authSecret, kiosk, now.getTime());
  const response = NextResponse.json(
    { name: kiosk.name, code, expiresAt, period: CODE_WINDOW_MS, serverNow: now.getTime(), build: process.env.APP_BUILD_ID ?? "dev" },
    { headers: NO_STORE },
  );
  if (!claims.iat || now.getTime() / 1000 - claims.iat > KIOSK_COOKIE_RENEW_SECONDS) {
    const cookie = await kioskCookie(kiosk._id, claims.did);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}
