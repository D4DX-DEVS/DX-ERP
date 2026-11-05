import { NextResponse, type NextRequest } from "next/server";
import { clientNetwork, directCors } from "@/lib/domain/kiosk";
import { signNetworkToken } from "@/lib/domain/kiosk-code";
import { env } from "@/lib/env";

/**
 * Signed proof of the caller's network for the QR same-network rule. Fetched straight from the Worker's own host,
 * where Cloudflare reports the real client address (the erp.d4dx.co proxy hides it), by the office screen and by
 * phones before a scan. Readable only by the app's own pages.
 */
export async function GET(request: NextRequest) {
  const headers = directCors(request);

  const net = await clientNetwork();
  if (!net) return NextResponse.json({ error: "Your network could not be determined." }, { status: 409, headers });
  return NextResponse.json({ net, token: signNetworkToken(env.authSecret, net, Date.now()) }, { headers });
}
