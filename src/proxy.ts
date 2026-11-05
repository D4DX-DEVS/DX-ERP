import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth/token";
import { directOrigin } from "@/lib/proxy-hosts";

const isDev = process.env.NODE_ENV === "development";

/**
 * Origins that serve user photos and the company logo (the public R2 bucket's URL, Google profile pictures).
 * Read per request: on Workers, `process.env` is populated per request, not at module load.
 */
function imageOrigins(): string {
  const origins = ["https://*.googleusercontent.com"];
  const publicFiles = process.env.PUBLIC_FILES_URL?.trim();
  if (publicFiles) {
    try {
      origins.push(new URL(publicFiles).origin);
    } catch {
      // Misconfigured URL: photos simply fall back to initials.
    }
  }
  return origins.join(" ");
}

/**
 * Nonce-based Content-Security-Policy (defence in depth: React escapes all output and there are no third-party
 * scripts). Next.js reads the `nonce-…` value from this header and stamps it on every script it emits, so only
 * our own bundles run. Styles keep `'unsafe-inline'`: the UI kit sets inline `style` attributes (charts, table
 * column rules), next/font and sonner inject `<style>` elements, and a nonce there would be ignored by browsers
 * once `'unsafe-inline'` is also present. Fonts are self-hosted by next/font; images come from R2 / Google.
 */
function contentSecurityPolicy(nonce: string, directOrigin: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${imageOrigins()}`,
    "font-src 'self' data:",
    // The service worker (/sw.js); 'strict-dynamic' above would otherwise ignore 'self' for it.
    "worker-src 'self'",
    // directOrigin: the Worker's own host, for network tokens when the page is served through the erp.d4dx.co proxy.
    `connect-src 'self'${directOrigin ? ` ${directOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
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
  const csp = contentSecurityPolicy(nonce, directOrigin(request.headers.get("host"), request.headers.get("x-forwarded-host")));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const withCsp = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  // Sign-in, and the office QR attendance screen (authenticated by its own link token + device cookie).
  if (pathname === "/login" || pathname.startsWith("/login/") || pathname.startsWith("/kiosk/")) {
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
  // The service worker script and its offline page must load without a session (no redirect to /login).
  matcher: ["/((?!api|_next/static|_next/image|brand|icon.png|apple-icon.png|favicon.ico|manifest.webmanifest|robots.txt|sw.js|offline.html).*)"],
};
