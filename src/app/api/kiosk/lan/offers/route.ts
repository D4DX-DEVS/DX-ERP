import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { directCors, kioskFromHubToken } from "@/lib/domain/kiosk";
import { KioskLanSignal } from "@/lib/models";

/** An offer the screen hasn't answered within this long is abandoned (the phone has given up). */
const OFFER_TTL_MS = 20_000;

/**
 * QR screen side of the local Wi-Fi handshake: phones' pending WebRTC offers for this screen. Polled every couple
 * of seconds straight on the Worker's own host (`?t=` from /api/kiosk/code), not through the erp.d4dx.co proxy.
 */
export async function GET(request: NextRequest) {
  const headers = directCors(request);
  const kiosk = await kioskFromHubToken(request.nextUrl.searchParams.get("t"));
  if (!kiosk) return NextResponse.json({ error: "Not a screen." }, { status: 401, headers });
  const offers = await db()
    .select({ id: KioskLanSignal._id, sdp: KioskLanSignal.offer })
    .from(KioskLanSignal)
    .where(and(eq(KioskLanSignal.kiosk, kiosk), isNull(KioskLanSignal.answer), gt(KioskLanSignal.createdAt, new Date(Date.now() - OFFER_TTL_MS))))
    .orderBy(asc(KioskLanSignal.createdAt))
    .limit(10);
  return NextResponse.json({ offers }, { headers });
}
