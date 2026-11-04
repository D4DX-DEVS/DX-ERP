import path from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

// The Content-Security-Policy is set per request in `src/proxy.ts` (nonce-based), not here.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera: staff scan the office attendance QR from their portal.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Every ERP screen is per-user and request-time; Cache Components / PPR are not used.
  cacheComponents: false,
  poweredByHeader: false,
  // Only small static brand marks use next/image; Workers would need a paid Images binding to optimise them.
  images: { unoptimized: true },
  // Dev-only: Next logs every Server Function call with its arguments — that would print vault secrets,
  // salaries and the super admin password to the terminal.
  logging: { serverFunctions: false },
  serverExternalPackages: ["exceljs", "jspdf", "jspdf-autotable", "nodemailer"],
  experimental: {
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "12mb",
      // erp.d4dx.co reaches the Worker through a proxy rule in the d4dx.co Cloudflare account, so requests arrive
      // addressed to the workers.dev host while the browser's Origin is erp.d4dx.co. Without this, Next.js aborts
      // every Server Action (sign-in, forms) as cross-origin.
      allowedOrigins: ["erp.d4dx.co"],
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    // Pin the workspace root so a stray lockfile in a parent folder is never picked up.
    root: path.resolve(process.cwd()),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

// Makes the Cloudflare bindings (local D1 / R2 in .wrangler/state) available to `next dev`.
initOpenNextCloudflareForDev();
