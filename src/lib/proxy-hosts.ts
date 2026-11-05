/**
 * Public hosts that reach the Worker through a proxy in the d4dx.co Cloudflare account (requests arrive addressed
 * to the workers.dev host). Server Actions accept them as origins, and pages served there may fetch network
 * tokens from the Worker's direct host.
 */
export const PROXY_HOSTS = ["erp.d4dx.co"];

/**
 * Origin where the Worker sees the client's real address: its own host when the request came through a proxy
 * that rewrote the host (erp.d4dx.co → *.workers.dev), else "" (same origin).
 */
export function directOrigin(host: string | null, forwardedHost: string | null, protocol = "https:"): string {
  return host && forwardedHost && forwardedHost !== host ? `${protocol}//${host}` : "";
}
