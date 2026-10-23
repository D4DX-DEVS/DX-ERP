import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/token";

const isDev = process.env.NODE_ENV === "development";

/** Origins that serve user photos and the company logo (DigitalOcean Spaces / CDN, Google profile pictures). */
function imageOrigins(): string[] {
  const origins = ["https://*.googleusercontent.com"];
  const cdn = process.env.DO_SPACES_CDN_URL?.trim().replace(/\/+$/, "");
  if (cdn) origins.push(cdn);
  const endpoint = process.env.DO_SPACES_ENDPOINT?.trim();
  const bucket = process.env.DO_SPACES_BUCKET?.trim();
  if (endpoint && bucket) {
    try {
      const u = new URL(endpoint.startsWith("http") ? endpoint : `https://${endpoint}`);
      origins.push(`${u.protocol}//${bucket}.${u.host}`);
    } catch {
      // Misconfigured endpoint: photos simply fall back to initials.
    }
  }
  return origins;
}

const IMAGE_ORIGINS = imageOrigins().join(" ");

/**
 * Nonce-based Content-Security-Policy (defence in depth: React escapes all output and there are no third-party
 * scripts). Next.js reads the `nonce-…` value from this header and stamps it on every script it emits, so only
 * our own bundles run. Styles keep `'unsafe-inline'`: the UI kit sets inline `style` attributes (charts, table
 * column rules), next/font and sonner inject `<style>` elements, and a nonce there would be ignored by browsers
 * once `'unsafe-inline'` is also present. Fonts are self-hosted by next/font; images come from Spaces / Google.
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${IMAGE_ORIGINS}`,
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Optimistic auth gate for pages: a missing/invalid session cookie redirects to /login.
 * Full checks (revocation, account status, permissions) happen server-side on every request.
 * Every page response also carries the per-request CSP nonce.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const withCsp = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
  }
  const claims = await verifyToken(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!claims) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" && pathname !== "/dashboard" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return withCsp(NextResponse.redirect(url));
  }
  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // Pages only — API routes authenticate themselves and return data, not documents; static assets are excluded.
  matcher: ["/((?!api|_next/static|_next/image|brand|icon.png|apple-icon.png|favicon.ico|manifest.webmanifest|robots.txt).*)"],
};
