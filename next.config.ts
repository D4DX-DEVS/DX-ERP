import path from "node:path";
import type { NextConfig } from "next";

// The Content-Security-Policy is set per request in `src/proxy.ts` (nonce-based), not here.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Every ERP screen is per-user and request-time; Cache Components / PPR are not used.
  cacheComponents: false,
  poweredByHeader: false,
  // Dev-only: Next logs every Server Function call with its arguments — that would print vault secrets,
  // salaries and the super admin password to the terminal.
  logging: { serverFunctions: false },
  serverExternalPackages: ["mongoose", "exceljs", "jspdf", "jspdf-autotable", "nodemailer"],
  experimental: {
    authInterrupts: true,
    serverActions: {
      bodySizeLimit: "12mb",
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
