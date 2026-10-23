import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";

/**
 * Drizzle client for this request's D1 binding (`DB` in wrangler.jsonc). Bindings belong to the
 * request, so the client is created per request (cached for the render) rather than per process.
 * Under `next dev` the binding is a local D1 in `.wrangler/state` (see `initOpenNextCloudflareForDev`).
 */
export const db = cache(() => drizzle(getCloudflareContext().env.DB));

export type Database = ReturnType<typeof db>;
