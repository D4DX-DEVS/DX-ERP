/**
 * Service worker (registered by `components/pwa/pwa-prompt.tsx`). Served from a route so its text carries the
 * build id: every deploy changes the script, the browser installs the new worker next to the running one, and
 * the page offers "Update" (the new worker waits until the user accepts).
 *
 * Pages are per-user and always fetched fresh (offline: a static offline page). Only content-hashed build
 * assets and brand images are cached.
 */
export const dynamic = "force-dynamic";

const BUILD_ID = process.env.APP_BUILD_ID ?? "dev";

const source = (version: string) => `
const CACHE = "dx-erp-" + ${JSON.stringify(version)};
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/brand/d4dx-logo.png", "/brand/icon-192.png"];

// Stored as a fresh Response: Workers assets redirect /offline.html to /offline, and a redirected response
// can't answer a navigation.
const unredirected = (url) =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error(url + " " + response.status);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  });

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(PRECACHE.map((url) => unredirected(url).then((response) => cache.put(url, response))))),
  );
});

// A new version waits until the user picks "Update"; the page then sends SKIP_WAITING.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("dx-erp-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
`;

export function GET() {
  return new Response(source(BUILD_ID), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
