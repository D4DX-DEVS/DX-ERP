/**
 * Fetches a signed proof of this device's network from `/api/kiosk/network` on `origin` (the Worker's direct host
 * when the page is served through a proxy, else "" for same origin). Null when it can't be had.
 */
export async function fetchNetworkToken(origin: string): Promise<{ net: string; token: string } | null> {
  try {
    const res = await fetch(`${origin}/api/kiosk/network`, { cache: "no-store", credentials: "omit" });
    return res.ok ? ((await res.json()) as { net: string; token: string }) : null;
  } catch {
    return null;
  }
}
