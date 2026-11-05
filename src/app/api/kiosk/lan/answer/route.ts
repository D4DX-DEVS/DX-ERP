import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { directCors, kioskFromHubToken, signalFromPollToken } from "@/lib/domain/kiosk";
import { KioskLanSignal } from "@/lib/models";

const MAX_SDP = 12_000;

/** Phone side: the screen's WebRTC answer to its offer, once there is one (`?t=` from startLanCheck). */
export async function GET(request: NextRequest) {
  const headers = directCors(request);
  const signal = await signalFromPollToken(request.nextUrl.searchParams.get("t"));
  if (!signal) return NextResponse.json({ error: "Expired." }, { status: 401, headers });
  const [row] = await db().select({ answer: KioskLanSignal.answer }).from(KioskLanSignal).where(eq(KioskLanSignal._id, signal)).limit(1);
  return NextResponse.json({ answer: row?.answer ?? null }, { headers });
}

/** QR screen side: posts its answer (plain-text SDP body) to a phone's offer (`?t=` hub token, `?id=` the offer). */
export async function POST(request: NextRequest) {
  const headers = directCors(request);
  const kiosk = await kioskFromHubToken(request.nextUrl.searchParams.get("t"));
  if (!kiosk) return NextResponse.json({ error: "Not a screen." }, { status: 401, headers });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const sdp = await request.text();
  if (!sdp.startsWith("v=0") || sdp.length > MAX_SDP) return NextResponse.json({ error: "Bad answer." }, { status: 400, headers });
  await db()
    .update(KioskLanSignal)
    .set({ answer: sdp })
    .where(and(eq(KioskLanSignal._id, id), eq(KioskLanSignal.kiosk, kiosk), isNull(KioskLanSignal.answer)));
  return NextResponse.json({ ok: true }, { headers });
}
